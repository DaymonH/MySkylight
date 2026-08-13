"""External calendar accounts — connect / list / disconnect (F18 Google).

Read-only, one-way pull. This module is the **connect** scaffold: start the
Google OAuth flow, handle the callback (store tokens + discover calendars), list
connected accounts, and disconnect. Mapping discovered calendars to local ones
and the incremental pull engine are the next Phase 7 steps (read-only mirror).

Apple/iCloud (F20, CalDAV) will add its own connect path against the same
`ExternalAccount` store.
"""

import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import AsyncSessionLocal, get_session
from app.deps import AnyFamilyMember, FamilyOwnerOrAdult
from app.models.base import utcnow
from app.models.external import (
    ExternalAccount,
    ExternalAccountStatus,
    ExternalCalendar,
    ExternalProvider,
)
from app.schemas.external import (
    AppleConnectIn,
    AuthorizeUrlOut,
    ExternalAccountOut,
    ExternalCalendarOut,
    ExternalCalendarUpdateIn,
    ExternalSyncResult,
    IcsFeedConnectIn,
)
from app.services import caldav, external_sync, ics, ics_feed
from app.services import google_oauth as google
from app.services.realtime import bus

router = APIRouter(tags=["external"])
logger = logging.getLogger(__name__)

# A single ICS "account" per family holds all its subscribed feeds (each feed is a
# calendar under it). This fixed label makes the (family, provider, account_email)
# uniqueness a per-family singleton container.
_ICS_CONTAINER_LABEL = "Subscribed feeds"


def _frontend_return_url(family_id: uuid.UUID, outcome: str) -> str:
    """Where the OAuth callback bounces the browser once it's done — back to the
    family's calendar-sync page so the freshly-connected account is right there."""
    base = settings.frontend_url.rstrip("/")
    return f"{base}/app/family/{family_id}/integrations?external={outcome}"


@router.post(
    "/families/{family_id}/external/google/authorize",
    response_model=AuthorizeUrlOut,
)
async def google_authorize(family_id: uuid.UUID, _auth: FamilyOwnerOrAdult):
    """Return the Google consent URL to start a read-only connect (owner/adult)."""
    if not settings.google_oauth_configured:
        raise HTTPException(503, "Google Calendar sync is not configured on this server")
    state = google.sign_state(family_id)
    return AuthorizeUrlOut(authorize_url=google.build_authorize_url(state))


@router.get("/external/google/callback")
async def google_callback(
    state: str = Query(...),
    code: str | None = Query(None),
    error: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
):
    """Google's OAuth redirect target. No Clerk JWT here — the browser arrives
    straight from Google — so the signed `state` is what ties this back to a
    family. Stores tokens, discovers the account's calendars (unmapped), then
    bounces the browser back to the app."""
    try:
        family_id = google.verify_state(state)
    except google.GoogleOAuthError:
        raise HTTPException(400, "Invalid or expired OAuth state")

    if error or not code:
        return RedirectResponse(_frontend_return_url(family_id, "error"), status_code=303)

    try:
        tokens = await google.exchange_code(code)
        email = await google.fetch_account_email(tokens.access_token)
        discovered = await google.list_calendars(tokens.access_token)
    except google.GoogleOAuthError:
        return RedirectResponse(_frontend_return_url(family_id, "error"), status_code=303)

    # Upsert by (family, provider, email): reconnecting refreshes tokens in place
    # and tops up any newly-shared calendars without disturbing existing mappings.
    account = (
        await session.execute(
            select(ExternalAccount)
            .where(
                ExternalAccount.family_id == family_id,
                ExternalAccount.provider == ExternalProvider.google,
                ExternalAccount.account_email == email,
                ExternalAccount.deleted_at.is_(None),
            )
            .options(selectinload(ExternalAccount.calendars))
        )
    ).scalar_one_or_none()

    known_ids: set[str] = set()
    if account is None:
        account = ExternalAccount(
            family_id=family_id,
            provider=ExternalProvider.google,
            account_email=email,
        )
        session.add(account)
        await session.flush()  # need account.id for the calendar rows
    else:
        known_ids = {c.external_id for c in account.calendars}

    account.access_token = tokens.access_token
    if tokens.refresh_token:
        account.refresh_token = tokens.refresh_token
    account.token_expiry = tokens.expiry
    account.scopes = tokens.scope
    account.status = ExternalAccountStatus.active

    for cal in discovered:
        if cal.external_id not in known_ids:
            session.add(
                ExternalCalendar(
                    account_id=account.id,
                    family_id=family_id,
                    external_id=cal.external_id,
                    name=cal.name,
                    color=cal.color,
                )
            )

    await session.commit()
    return RedirectResponse(_frontend_return_url(family_id, "connected"), status_code=303)


@router.post(
    "/families/{family_id}/external/apple/connect",
    response_model=ExternalAccountOut,
    status_code=201,
)
async def apple_connect(
    family_id: uuid.UUID,
    data: AppleConnectIn,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    """Connect an iCloud account via CalDAV (owner/adult). Validates the Apple ID
    + app-specific password by discovering the account's calendars, stores the
    credential, and records the discovered calendars (unmapped). Read-only."""
    try:
        discovered = await caldav.discover_calendars(data.apple_id, data.app_password)
    except caldav.CalDavAuthError:
        raise HTTPException(401, "Apple ID or app-specific password was rejected")
    except caldav.CalDavError:
        raise HTTPException(502, "Could not reach iCloud CalDAV")

    # Upsert by (family, apple, apple_id): reconnect refreshes the stored password
    # and tops up newly-shared calendars without disturbing existing mappings.
    account = (
        await session.execute(
            select(ExternalAccount)
            .where(
                ExternalAccount.family_id == family_id,
                ExternalAccount.provider == ExternalProvider.apple,
                ExternalAccount.account_email == data.apple_id,
                ExternalAccount.deleted_at.is_(None),
            )
            .options(selectinload(ExternalAccount.calendars))
        )
    ).scalar_one_or_none()

    known_ids: set[str] = set()
    if account is None:
        account = ExternalAccount(
            family_id=family_id,
            provider=ExternalProvider.apple,
            account_email=data.apple_id,
        )
        session.add(account)
        await session.flush()
    else:
        known_ids = {c.external_id for c in account.calendars}

    # No OAuth token here — the app-specific password is the durable credential,
    # replayed on every CalDAV request. Stored in refresh_token (self-hosted).
    account.refresh_token = data.app_password
    account.status = ExternalAccountStatus.active

    for cal in discovered:
        if cal.external_id not in known_ids:
            session.add(
                ExternalCalendar(
                    account_id=account.id,
                    family_id=family_id,
                    external_id=cal.external_id,
                    name=cal.name,
                    color=cal.color,
                )
            )

    await session.commit()
    return (
        await session.execute(
            select(ExternalAccount)
            .where(ExternalAccount.id == account.id)
            .options(selectinload(ExternalAccount.calendars))
        )
    ).scalar_one()


@router.post(
    "/families/{family_id}/external/ics/connect",
    response_model=ExternalAccountOut,
    status_code=201,
)
async def ics_connect(
    family_id: uuid.UUID,
    data: IcsFeedConnectIn,
    background_tasks: BackgroundTasks,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    """Subscribe to a read-only `.ics` feed (owner/adult), e.g. a US-Holidays
    calendar. Validates the URL by fetching + parsing it once, records it as a
    synced calendar under the family's ICS container account, and kicks an
    immediate background pull so its events appear without waiting for the
    scheduler. The scheduler then re-fetches it every few minutes, so future
    years' events flow in automatically — no re-import needed."""
    url = ics_feed.normalize_feed_url(data.url)
    try:
        text = await ics_feed.fetch_feed(url)
    except ics_feed.IcsFeedError:
        raise HTTPException(502, "Could not fetch that calendar feed")
    try:
        ics.parse_ics(text)  # validate it really is iCalendar before storing
    except (ValueError, KeyError):
        raise HTTPException(400, "That URL is not a valid iCalendar (.ics) feed")
    name = data.name or ics_feed.feed_name(text) or "Subscribed calendar"

    # Find-or-create the family's ICS container account, then add (or re-enable)
    # this feed as a calendar under it, keyed by the normalised URL so re-adding
    # the same feed updates in place instead of duplicating.
    account = (
        await session.execute(
            select(ExternalAccount)
            .where(
                ExternalAccount.family_id == family_id,
                ExternalAccount.provider == ExternalProvider.ics,
                ExternalAccount.account_email == _ICS_CONTAINER_LABEL,
                ExternalAccount.deleted_at.is_(None),
            )
            .options(selectinload(ExternalAccount.calendars))
        )
    ).scalar_one_or_none()

    existing: ExternalCalendar | None = None
    if account is None:
        account = ExternalAccount(
            family_id=family_id,
            provider=ExternalProvider.ics,
            account_email=_ICS_CONTAINER_LABEL,
            status=ExternalAccountStatus.active,
        )
        session.add(account)
        await session.flush()  # need account.id for the calendar row
    else:
        account.status = ExternalAccountStatus.active
        existing = next((c for c in account.calendars if c.external_id == url), None)

    if existing is not None:
        existing.name = name
        if data.color:
            existing.color = data.color
        existing.synced = True
        existing.sync_token = None  # force a clean full pull
    else:
        session.add(
            ExternalCalendar(
                account_id=account.id,
                family_id=family_id,
                external_id=url,
                name=name,
                color=data.color,
                synced=True,
            )
        )

    await session.commit()
    # Pull now, off the request path — a large feed can exceed the proxy timeout.
    background_tasks.add_task(_resync_account_bg, account.id)

    return (
        await session.execute(
            select(ExternalAccount)
            .where(ExternalAccount.id == account.id)
            .options(selectinload(ExternalAccount.calendars))
        )
    ).scalar_one()


@router.get(
    "/families/{family_id}/external/accounts",
    response_model=list[ExternalAccountOut],
)
async def list_external_accounts(
    family_id: uuid.UUID,
    _auth: AnyFamilyMember,
    session: AsyncSession = Depends(get_session),
):
    """Connected external accounts for the family, with their discovered calendars."""
    rows = (
        await session.execute(
            select(ExternalAccount)
            .where(
                ExternalAccount.family_id == family_id,
                ExternalAccount.deleted_at.is_(None),
            )
            .options(selectinload(ExternalAccount.calendars))
            .order_by(ExternalAccount.created_at)
        )
    ).scalars().all()
    return rows


@router.delete(
    "/families/{family_id}/external/accounts/{account_id}",
    status_code=204,
)
async def disconnect_external_account(
    family_id: uuid.UUID,
    account_id: uuid.UUID,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    """Disconnect an account (owner/adult). Soft-deletes the connection; mirrored
    events already pulled are left untouched."""
    account = await session.get(ExternalAccount, account_id)
    if not account or account.family_id != family_id or account.deleted_at:
        raise HTTPException(404, "External account not found")
    account.deleted_at = utcnow()
    await session.commit()


@router.put(
    "/families/{family_id}/external/calendars/{ext_cal_id}",
    response_model=ExternalCalendarOut,
)
async def update_external_calendar(
    family_id: uuid.UUID,
    ext_cal_id: uuid.UUID,
    data: ExternalCalendarUpdateIn,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    """Update a discovered external calendar's mirror settings (owner/adult).

    Partial update — only the fields present change:
    - ``synced``: turn read-only mirroring on/off. Enabling resets the sync cursor
      so the next sync does a full re-pull (the mirroring happens then); disabling
      hides its events until re-enabled.
    - ``color``: re-tint this calendar's events. Mirror events carry no color of
      their own — they resolve it live from the calendar — so the new tint shows
      on the next occurrence fetch, no re-sync needed.
    """
    ext_cal = await session.get(ExternalCalendar, ext_cal_id)
    if not ext_cal or ext_cal.family_id != family_id:
        raise HTTPException(404, "External calendar not found")
    account = await session.get(ExternalAccount, ext_cal.account_id)
    if not account or account.deleted_at:
        raise HTTPException(404, "External calendar not found")

    if data.synced is not None:
        ext_cal.synced = data.synced
        if data.synced:
            # Force a full re-pull on next sync — a stale incremental cursor would
            # only deliver deltas, leaving prior events missing.
            ext_cal.sync_token = None
    if data.color is not None:
        ext_cal.color = data.color
    await session.commit()
    # Toggling sync changes which events show, and a recolor changes how they
    # render (effective_color falls back to the calendar's color) — nudge
    # connected devices to refetch occurrences so the wall display keeps up.
    await bus.publish(str(family_id), "event.updated", {"source": "external-calendar"})
    return ExternalCalendarOut.model_validate(ext_cal)


@router.post(
    "/families/{family_id}/external/accounts/{account_id}/sync",
    response_model=ExternalSyncResult,
)
async def sync_external_account(
    family_id: uuid.UUID,
    account_id: uuid.UUID,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    """Pull mapped calendars into their local mirrors now (owner/adult).

    A fast **incremental** pull — it must finish well inside the frontend proxy's
    request timeout, so it deliberately does *not* force a full re-pull (a full
    CalDAV pull re-fetches the whole collection and can exceed that budget). The
    reconcile that prunes stale rows runs on a **full** pull, which happens off
    the request path: on the scheduler's periodic run, after a provider sync-token
    expiry, or after toggling a calendar off→on (which resets the cursor).

    Status mapping: 409 when the account needs reconnecting (token/password
    missing or rejected); 502 with the provider's message for any other sync
    failure; 500 (with the error type) for an unexpected one.
    """
    account = (
        await session.execute(
            select(ExternalAccount)
            .where(ExternalAccount.id == account_id)
            .options(selectinload(ExternalAccount.calendars))
        )
    ).scalar_one_or_none()
    if not account or account.family_id != family_id or account.deleted_at:
        raise HTTPException(404, "External account not found")
    # Apple needs no server-side config; only Google is gated on credentials.
    if account.provider == ExternalProvider.google and not settings.google_oauth_configured:
        raise HTTPException(503, "Google Calendar sync is not configured on this server")

    try:
        counts = await external_sync.sync_account(account, session)
    except (google.GoogleOAuthError, caldav.CalDavError, ics_feed.IcsFeedError) as e:
        # The engine flags auth failures as needs_reauth (and commits it) before
        # raising — that's a reconnect, not a transient error.
        if account.status == ExternalAccountStatus.needs_reauth:
            raise HTTPException(409, "Account needs to be reconnected")
        logger.warning(
            "External sync failed (account=%s provider=%s): %s", account_id, account.provider, e
        )
        raise HTTPException(502, f"Sync failed: {e}")
    except Exception as e:  # surface the real reason instead of a bare 500
        logger.exception("Unexpected external sync error (account=%s)", account_id)
        raise HTTPException(500, f"Unexpected sync error: {type(e).__name__}: {e}")

    return ExternalSyncResult(
        account_id=account.id,
        status=account.status,
        calendars_synced=counts.calendars,
        created=counts.created,
        updated=counts.updated,
        deleted=counts.deleted,
    )


async def _resync_account_bg(account_id: uuid.UUID) -> None:
    """Full, reconciling re-pull for one account — runs off the request path.

    Opens its own session (the request's is already closed when this fires) and
    swallows errors like the scheduler, so a provider hiccup never crashes the
    worker. ``sync_account`` commits and publishes the realtime nudge itself, so
    connected devices refresh once the reconcile finishes.
    """
    async with AsyncSessionLocal() as session:
        account = (
            await session.execute(
                select(ExternalAccount)
                .where(ExternalAccount.id == account_id, ExternalAccount.deleted_at.is_(None))
                .options(selectinload(ExternalAccount.calendars))
            )
        ).scalar_one_or_none()
        if account is None:
            return
        try:
            counts = await external_sync.sync_account(account, session, force_full=True)
            logger.info(
                "External resync done (account=%s): +%d ~%d -%d",
                account_id, counts.created, counts.updated, counts.deleted,
            )
        except Exception:
            logger.exception("External resync failed (account=%s)", account_id)


@router.post(
    "/families/{family_id}/external/accounts/{account_id}/resync",
    status_code=202,
)
async def resync_external_account(
    family_id: uuid.UUID,
    account_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    """Queue a full, reconciling re-pull and return immediately (owner/adult).

    Unlike "Sync now" (a fast incremental pull), this re-fetches the whole source
    and soft-deletes mirror rows the source no longer has — clearing leftover
    duplicate events. It runs in the **background** because a full CalDAV pull
    re-reads the entire collection and can exceed the frontend proxy's request
    timeout; the realtime nudge refreshes the UI when it's done.
    """
    account = await session.get(ExternalAccount, account_id)
    if not account or account.family_id != family_id or account.deleted_at:
        raise HTTPException(404, "External account not found")
    if account.provider == ExternalProvider.google and not settings.google_oauth_configured:
        raise HTTPException(503, "Google Calendar sync is not configured on this server")

    background_tasks.add_task(_resync_account_bg, account_id)
    return {"status": "started"}


@router.post("/families/{family_id}/external/cleanup-duplicates")
async def cleanup_duplicate_events(
    family_id: uuid.UUID,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    """Remove leftover duplicate read-only mirror events (owner/adult).

    Collapses same-event mirror copies the sync engine can't reach — rows an
    earlier migration left unlinked/stale, which show as read-only duplicates the
    user can neither sync away nor delete — keeping one live copy each. Pure DB
    (no provider call), so it's fast, synchronous, and returns the count removed.
    """
    removed = await external_sync.cleanup_duplicate_mirror_events(family_id, session)
    return {"removed": removed}
