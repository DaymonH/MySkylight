"""Read-only mirror engine for external calendars (Phase 7).

One-way pull only: a synced `ExternalCalendar`'s events are mirrored in as
ordinary `Event` rows whose `external_calendar_id` points back at it; we never
write back to the provider. A mirrored event is tagged with a provider-namespaced
`Event.ical_uid` so re-syncs update the same row (and upstream deletions
soft-delete it) instead of duplicating.

The engine is provider-agnostic at the seam: a provider fetches+maps its events
into neutral `MirrorEvent`s, then `apply_mirror_events` upserts them. Google (F18)
is wired here; Apple/iCloud (F20, CalDAV) plugs into the same `apply_mirror_events`.

Identity & deliberate simplifications:
- Mirror key = ``"<provider>:<external_calendar_id>:<event_id>"`` stored in
  `ical_uid`, scoped per local calendar — collision-free even if two external
  calendars map to one local calendar, and distinct from user ICS imports.
- Recurring **masters** mirror with their RRULE; per-occurrence overrides and
  cancellations of single instances are dropped (matches the ICS importer). The
  series may therefore show an occurrence the upstream cancelled — acceptable for
  a read-only mirror; revisit if/when two-way sync lands.
- A stale ``syncToken`` (410) triggers a full re-pull; events deleted upstream
  during the gap won't carry a cancellation and may linger until the next edit.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import utcnow
from app.models.calendar import Event
from app.models.external import (
    ExternalAccount,
    ExternalAccountStatus,
    ExternalCalendar,
    ExternalProvider,
    is_external_mirror,
)
from app.services import caldav, google_oauth, ics, ics_feed
from app.services.realtime import bus

# Refresh the access token if it expires within this margin (clock skew + latency).
_EXPIRY_MARGIN = timedelta(seconds=60)


def _as_utc(dt: datetime) -> datetime:
    """Attach UTC to a naive datetime (SQLite stores DateTime columns without tz)."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


@dataclass
class MirrorEvent:
    """A provider's event flattened to what a mirrored local `Event` needs."""

    uid: str  # provider-namespaced, stable across syncs
    deleted: bool  # upstream deletion → soft-delete the mirror row
    title: str
    description: str | None
    location: str | None
    start_dt: datetime | None
    end_dt: datetime | None
    all_day: bool
    rrule: str | None


@dataclass
class SyncCounts:
    created: int = 0
    updated: int = 0
    deleted: int = 0
    calendars: int = 0  # mapped calendars actually synced

    @property
    def total(self) -> int:
        return self.created + self.updated + self.deleted

    def __iadd__(self, other: "SyncCounts") -> "SyncCounts":
        self.created += other.created
        self.updated += other.updated
        self.deleted += other.deleted
        self.calendars += other.calendars
        return self


# ── Shared upsert (provider-agnostic) ────────────────────────────────────────


async def apply_mirror_events(
    ext_cal: ExternalCalendar,
    uid_prefix: str,
    events: list[MirrorEvent],
    session: AsyncSession,
    *,
    reconcile: bool = False,
    window_start: datetime | None = None,
) -> SyncCounts:
    """Upsert ``events`` into ``ext_cal``'s mapped local calendar.

    Existing mirror rows are matched by ``ical_uid``; a known uid updates, an
    unknown one inserts, and a ``deleted`` event soft-deletes its row. Rows are
    scoped by ``uid_prefix`` so we never touch ICS imports or other providers'
    events living in the same local calendar.

    Incremental pulls only carry *changes*, so a row absent from ``events`` is
    not necessarily gone upstream — it just didn't change. A **full** pull, by
    contrast, is a complete snapshot, so when ``reconcile`` is set we also
    soft-delete any mirror row whose uid the snapshot didn't contain. This is
    what makes the mirror converge to the source: it clears events deleted
    upstream while a sync token was stale, and stale rows left behind by an
    earlier keying/linkage (the usual cause of long-lived "duplicates"). It runs
    **only** on a full pull — never incrementally, or it would wipe everything.

    ``window_start`` guards reconcile against the pull's time bound: a full pull
    is bounded to a recent window, so a one-off event ending before it isn't in
    the snapshot for a different reason (out of window, not deleted) and must be
    left alone. Recurring masters are always returned by a full pull, so they're
    always reconcilable. Pass ``window_start=None`` when the snapshot is the whole
    collection (CalDAV).
    """
    counts = SyncCounts()
    if not ext_cal.synced:
        return counts  # toggled off: nothing to mirror in

    rows = (
        await session.execute(
            select(Event).where(
                Event.external_calendar_id == ext_cal.id,
                Event.deleted_at.is_(None),
                Event.ical_uid.is_not(None),
            )
        )
    ).scalars().all()
    # Python-side prefix filter avoids LIKE-wildcard escaping on the external id.
    by_uid: dict[str, Event] = {
        e.ical_uid: e for e in rows if e.ical_uid.startswith(uid_prefix)
    }

    seen: set[str] = set()
    for me in events:
        seen.add(me.uid)
        target = by_uid.get(me.uid)
        if me.deleted:
            if target is not None:
                target.deleted_at = utcnow()
                counts.deleted += 1
            continue
        if me.start_dt is None or me.end_dt is None:
            continue  # unusable (no times) — skip defensively
        if target is not None:
            target.title = me.title
            target.description = me.description
            target.location = me.location
            target.start_dt = me.start_dt
            target.end_dt = me.end_dt
            target.all_day = me.all_day
            target.rrule = me.rrule
            counts.updated += 1
        else:
            session.add(
                Event(
                    family_id=ext_cal.family_id,
                    external_calendar_id=ext_cal.id,
                    title=me.title,
                    description=me.description,
                    location=me.location,
                    start_dt=me.start_dt,
                    end_dt=me.end_dt,
                    all_day=me.all_day,
                    rrule=me.rrule,
                    ical_uid=me.uid,
                )
            )
            counts.created += 1

    if reconcile:
        for uid, ev in by_uid.items():
            if uid in seen or ev.deleted_at is not None:
                continue
            # A one-off ending before the pull window is absent for a benign
            # reason (out of window), not because it was deleted — skip it.
            # Recurring masters are always in a full pull, so always reconcilable.
            if window_start is not None and ev.rrule is None and _as_utc(ev.end_dt) < window_start:
                continue
            ev.deleted_at = utcnow()
            counts.deleted += 1

    return counts


# ── Google provider ──────────────────────────────────────────────────────────


def _google_uid(ext_cal: ExternalCalendar, event_id: str) -> str:
    return f"google:{ext_cal.external_id}:{event_id}"


def _google_to_mirror(ext_cal: ExternalCalendar, ge: google_oauth.GoogleEvent) -> MirrorEvent | None:
    """Map a `GoogleEvent` to a `MirrorEvent`, or ``None`` to skip it."""
    if ge.recurring_event_id:
        return None  # per-occurrence override — not mirrored yet
    uid = _google_uid(ext_cal, ge.external_id)
    if ge.status == "cancelled":
        return MirrorEvent(
            uid=uid, deleted=True, title="", description=None, location=None,
            start_dt=None, end_dt=None, all_day=False, rrule=None,
        )
    return MirrorEvent(
        uid=uid,
        deleted=False,
        title=ge.title,
        description=ge.description,
        location=ge.location,
        start_dt=ge.start_dt,
        end_dt=ge.end_dt,
        all_day=ge.all_day,
        rrule=ge.rrule,
    )


async def ensure_fresh_token(account: ExternalAccount, session: AsyncSession) -> str:
    """Return a usable access token, refreshing it first if it's expired/expiring.

    On an unrecoverable failure (no refresh token, or Google rejecting the
    refresh) the account is flagged ``needs_reauth`` and the error re-raised.
    """
    # SQLite returns DateTime(timezone=True) columns as naive — assume UTC so the
    # comparison against tz-aware utcnow() doesn't blow up.
    expiry = account.token_expiry
    if expiry is not None and expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    fresh = (
        account.access_token
        and expiry is not None
        and expiry > utcnow() + _EXPIRY_MARGIN
    )
    if fresh:
        return account.access_token

    if not account.refresh_token:
        account.status = ExternalAccountStatus.needs_reauth
        await session.commit()
        raise google_oauth.GoogleOAuthError("No refresh token — reconnect required")

    try:
        tokens = await google_oauth.refresh_access_token(account.refresh_token)
    except google_oauth.GoogleOAuthError:
        account.status = ExternalAccountStatus.needs_reauth
        await session.commit()
        raise

    account.access_token = tokens.access_token
    if tokens.refresh_token:
        account.refresh_token = tokens.refresh_token
    account.token_expiry = tokens.expiry
    account.status = ExternalAccountStatus.active
    await session.flush()
    return tokens.access_token


async def _sync_google_calendar(
    ext_cal: ExternalCalendar, access_token: str, session: AsyncSession, *, force_full: bool = False
) -> SyncCounts:
    # A full pull (no token) is a complete snapshot we can reconcile against;
    # an incremental pull (stored token) carries only changes and must not.
    token = None if force_full else ext_cal.sync_token
    full = token is None
    try:
        page = await google_oauth.fetch_events(access_token, ext_cal.external_id, sync_token=token)
    except google_oauth.SyncTokenExpired:
        page = await google_oauth.fetch_events(access_token, ext_cal.external_id, sync_token=None)
        full = True

    mirror_events = [
        me for ge in page.events if (me := _google_to_mirror(ext_cal, ge)) is not None
    ]
    counts = await apply_mirror_events(
        ext_cal, f"google:{ext_cal.external_id}:", mirror_events, session,
        reconcile=full, window_start=page.time_min if full else None,
    )
    counts.calendars = 1
    ext_cal.sync_token = page.next_sync_token
    ext_cal.last_synced_at = utcnow()
    return counts


# ── Apple/iCloud provider (CalDAV) ────────────────────────────────────────────


def _caldav_to_mirror(uid: str, res: caldav.CalDavResource) -> MirrorEvent | None:
    """Map a CalDAV resource to a MirrorEvent. The body is iCalendar text, so the
    ICS parser does the VEVENT mapping; we take the master (first) VEVENT and drop
    RECURRENCE-ID overrides, matching the Google path."""
    if res.deleted:
        return MirrorEvent(
            uid=uid, deleted=True, title="", description=None, location=None,
            start_dt=None, end_dt=None, all_day=False, rrule=None,
        )
    if not res.calendar_data:
        return None
    parsed = ics.parse_ics(res.calendar_data)
    if not parsed:
        return None  # VTODO / VJOURNAL only — nothing to mirror
    pe = parsed[0]
    return MirrorEvent(
        uid=uid,
        deleted=False,
        title=pe.title,
        description=pe.description,
        location=pe.location,
        start_dt=pe.start_dt,
        end_dt=pe.end_dt,
        all_day=pe.all_day,
        rrule=pe.rrule,
    )


async def _sync_apple_calendar(
    account: ExternalAccount, ext_cal: ExternalCalendar, session: AsyncSession,
    *, force_full: bool = False,
) -> SyncCounts:
    # CalDAV keys events by resource href (a removal only tells us the href, not
    # the UID), so the mirror uid is namespaced by href rather than event UID.
    username, password = account.account_email, account.refresh_token
    # An empty sync token pulls the whole collection — a complete snapshot we can
    # reconcile against (no time window, so window_start stays None below).
    token = None if force_full else ext_cal.sync_token
    full = token is None
    try:
        page = await caldav.fetch_events(ext_cal.external_id, username, password, sync_token=token)
    except caldav.CalDavSyncTokenError:
        page = await caldav.fetch_events(ext_cal.external_id, username, password, sync_token=None)
        full = True

    uid_prefix = f"apple:{ext_cal.external_id}:"
    mirror_events = [
        me
        for res in page.resources
        if (me := _caldav_to_mirror(f"{uid_prefix}{res.href}", res)) is not None
    ]
    counts = await apply_mirror_events(
        ext_cal, uid_prefix, mirror_events, session, reconcile=full, window_start=None
    )
    counts.calendars = 1
    ext_cal.sync_token = page.next_sync_token
    ext_cal.last_synced_at = utcnow()
    return counts


# ── Subscribed ICS feed provider ──────────────────────────────────────────────


def _ics_to_mirror(uid: str, pe: ics.ParsedEvent) -> MirrorEvent:
    """Map a parsed feed VEVENT to a MirrorEvent (always live — a feed snapshot
    lists what exists; removals are handled by reconcile, not per-event flags)."""
    return MirrorEvent(
        uid=uid,
        deleted=False,
        title=pe.title,
        description=pe.description,
        location=pe.location,
        start_dt=pe.start_dt,
        end_dt=pe.end_dt,
        all_day=pe.all_day,
        rrule=pe.rrule,
    )


async def _sync_ics_calendar(
    ext_cal: ExternalCalendar, session: AsyncSession, *, force_full: bool = False
) -> SyncCounts:
    """Re-fetch a subscribed `.ics` feed and mirror its events in (read-only).

    A feed has no incremental protocol, so **every** pull is a complete snapshot —
    we always reconcile (no time window) so the mirror converges to exactly the
    feed's current contents, which is what lets next year's holidays appear and
    dropped years fall off without any user action. ``force_full`` is therefore a
    no-op here (kept for a uniform provider signature).
    """
    text = await ics_feed.fetch_feed(ext_cal.external_id)
    uid_prefix = f"ics:{ext_cal.external_id}:"

    seen: set[str] = set()
    mirror_events: list[MirrorEvent] = []
    for pe in ics.parse_ics(text):
        # Feed events carry a UID; fall back to a stable identity for the rare one
        # that doesn't, so re-syncs still upsert the same row instead of duplicating.
        event_uid = pe.uid or f"{pe.title}@{pe.start_dt.isoformat()}"
        uid = f"{uid_prefix}{event_uid}"
        if uid in seen:
            continue  # collapse a recurring master + its RECURRENCE-ID overrides
        seen.add(uid)
        mirror_events.append(_ics_to_mirror(uid, pe))

    # A feed that parses to *zero* events is almost always a transient fetch glitch
    # (an empty/garbled body returned with 200), not a genuinely empty calendar.
    # Skip rather than let reconcile soft-delete every mirrored event.
    if not mirror_events:
        ext_cal.last_synced_at = utcnow()
        return SyncCounts(calendars=1)

    counts = await apply_mirror_events(
        ext_cal, uid_prefix, mirror_events, session, reconcile=True, window_start=None
    )
    counts.calendars = 1
    ext_cal.sync_token = None  # feeds have no cursor; always a full snapshot
    ext_cal.last_synced_at = utcnow()
    return counts


# ── Orchestration ──────────────────────────────────────────────────────────


async def sync_account(
    account: ExternalAccount, session: AsyncSession, *, force_full: bool = False
) -> SyncCounts:
    """Pull every synced calendar on ``account`` into the family (read-only).

    Commits the mirrored changes and publishes a realtime nudge so connected
    devices refresh. ``account.calendars`` must be eager-loaded by the caller.

    ``force_full`` ignores the stored sync cursor and does a complete-snapshot
    pull that **reconciles** (soft-deletes mirror rows no longer in the source).
    The background scheduler leaves it off (cheap incremental pulls, self-healing
    on the provider's periodic token expiry); the user-initiated "Sync now" turns
    it on so the mirror converges to exactly what the source has.
    """
    active = [c for c in account.calendars if c.synced]
    totals = SyncCounts()

    if account.provider == ExternalProvider.google:
        access_token = await ensure_fresh_token(account, session)
        for ext_cal in active:
            totals += await _sync_google_calendar(
                ext_cal, access_token, session, force_full=force_full
            )
    elif account.provider == ExternalProvider.apple:
        try:
            for ext_cal in active:
                totals += await _sync_apple_calendar(
                    account, ext_cal, session, force_full=force_full
                )
        except caldav.CalDavAuthError:
            account.status = ExternalAccountStatus.needs_reauth
            await session.commit()
            raise
    elif account.provider == ExternalProvider.ics:
        # A feed has no credentials, so a fetch failure is transient (bad/temporary
        # URL), never "needs reauth" — let it propagate so the manual endpoint
        # reports it and the scheduler simply retries next tick.
        for ext_cal in active:
            totals += await _sync_ics_calendar(ext_cal, session, force_full=force_full)
    else:
        raise google_oauth.GoogleOAuthError(f"Unsupported provider: {account.provider}")

    account.last_synced_at = utcnow()
    await session.commit()

    if totals.total:
        # A coarse nudge — the client invalidates its occurrence cache on this.
        await bus.publish(
            str(account.family_id),
            "event.created",
            {"source": account.provider.value},
        )
    return totals


# ── Duplicate cleanup (pure DB, no provider call) ─────────────────────────────


async def cleanup_duplicate_mirror_events(family_id: uuid.UUID, session: AsyncSession) -> int:
    """Collapse duplicate read-only mirror events to one live copy each.

    The sync reconcile only prunes rows still linked (by ``external_calendar_id``
    + matching uid prefix) to a synced calendar. Rows an older migration left
    **unlinked or stale-linked** carry a provider uid (so the UI treats them as
    read-only — the user can't delete them) yet still display, and reconcile can't
    reach them — they're the long-lived "duplicates". This is the catch-all: group
    the family's *visible* mirror events by identity (title + start + end + all-day)
    and, for any group with more than one, keep a single copy and soft-delete the
    rest. The keeper prefers a row still linked to a synced calendar (so ongoing
    syncs keep maintaining it), else the most recently updated. Pure DB — no
    provider call, so it's fast and can't hit the proxy timeout; mirrors are
    re-pullable, so deletion is safe. Returns how many rows were removed.
    """
    synced_cal_ids = set(
        (
            await session.execute(
                select(ExternalCalendar.id).where(
                    ExternalCalendar.family_id == family_id,
                    ExternalCalendar.synced.is_(True),
                )
            )
        ).scalars().all()
    )

    rows = (
        await session.execute(
            select(Event).where(
                Event.family_id == family_id,
                Event.deleted_at.is_(None),
                Event.ical_uid.is_not(None),
            )
        )
    ).scalars().all()

    def _visible_mirror(e: Event) -> bool:
        # Only mirror rows the calendar would actually render — never touch
        # toggled-off (non-synced) calendars' hidden events.
        if not is_external_mirror(e.ical_uid):
            return False
        return e.external_calendar_id is None or e.external_calendar_id in synced_cal_ids

    def _keeper_rank(e: Event):
        # Prefer a row still linked to a synced calendar (sync keeps maintaining
        # it); break ties by most-recently-updated.
        live = e.external_calendar_id in synced_cal_ids
        return (1 if live else 0, e.updated_at or e.created_at)

    groups: dict[tuple, list[Event]] = {}
    for e in rows:
        if not _visible_mirror(e):
            continue
        groups.setdefault((e.title, e.start_dt, e.end_dt, e.all_day), []).append(e)

    removed = 0
    for members in groups.values():
        if len(members) < 2:
            continue
        members.sort(key=_keeper_rank, reverse=True)
        for dup in members[1:]:
            dup.deleted_at = utcnow()
            removed += 1

    if removed:
        await session.commit()
        await bus.publish(str(family_id), "event.created", {"source": "cleanup"})
    return removed
