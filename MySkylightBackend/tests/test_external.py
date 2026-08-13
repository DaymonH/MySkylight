"""External calendar accounts — F18 Google connect scaffold.

Covers the OAuth state signing, the authorize endpoint (configured / not), the
callback (token exchange + calendar discovery, mocked — no live Google), listing,
disconnect, and family isolation. The live Google HTTP calls are exercised only
through mocks; end-to-end needs a real Google Cloud OAuth client.
"""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.calendar import Event
from app.models.external import (
    ExternalAccount,
    ExternalAccountStatus,
    ExternalCalendar,
    ExternalProvider,
    is_external_mirror,
)
from app.models.family import Family
from app.models.user import User
from app.services import caldav, external_sync, google_oauth, ics_feed


# ── helpers ───────────────────────────────────────────────────────────────────


async def _create_family(client, auth_headers, name: str = "Hansens") -> str:
    resp = await client.post("/api/v1/families", json={"name": name}, headers=auth_headers)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["id"]


@pytest.fixture
def google_configured(monkeypatch):
    """Pretend a Google OAuth client is configured (no real credentials)."""
    monkeypatch.setattr(settings, "google_client_id", "test-client-id.apps.googleusercontent.com")
    monkeypatch.setattr(settings, "google_client_secret", "test-secret")


# ── unit: signed state ──────────────────────────────────────────────────────


def test_state_sign_verify_roundtrip():
    fid = uuid.uuid4()
    state = google_oauth.sign_state(fid)
    assert google_oauth.verify_state(state) == fid


def test_state_rejects_tampering():
    state = google_oauth.sign_state(uuid.uuid4())
    body, _sig = state.split(".", 1)
    forged = f"{body}.{'A' * 43}"
    with pytest.raises(google_oauth.GoogleOAuthError):
        google_oauth.verify_state(forged)
    with pytest.raises(google_oauth.GoogleOAuthError):
        google_oauth.verify_state("not-a-valid-state")


# ── unit: OAuth helpers ──────────────────────────────────────────────────────


def test_build_authorize_url_includes_scope_and_state(google_configured):
    state = google_oauth.sign_state(uuid.uuid4())
    url = google_oauth.build_authorize_url(state)
    assert url.startswith(google_oauth.AUTH_ENDPOINT)
    assert "client_id=test-client-id" in url
    assert "calendar.readonly" in url
    assert "access_type=offline" in url
    assert f"state={state}" in url


def test_build_authorize_url_requires_config():
    with pytest.raises(google_oauth.GoogleOAuthError):
        google_oauth.build_authorize_url("state")


async def test_exchange_code_parses_tokens(google_configured):
    async def _fake_post(self, url, *args, **kwargs):
        return httpx.Response(
            200,
            json={
                "access_token": "ya29.at",
                "refresh_token": "1//rt",
                "expires_in": 3599,
                "scope": "https://www.googleapis.com/auth/calendar.readonly",
            },
            request=httpx.Request("POST", url),
        )

    with patch("httpx.AsyncClient.post", _fake_post):
        tokens = await google_oauth.exchange_code("auth-code")
    assert tokens.access_token == "ya29.at"
    assert tokens.refresh_token == "1//rt"
    assert tokens.expires_in == 3599


# ── API: authorize ───────────────────────────────────────────────────────────


async def test_authorize_503_when_not_configured(client, auth_headers):
    fid = await _create_family(client, auth_headers)
    res = await client.post(
        f"/api/v1/families/{fid}/external/google/authorize", headers=auth_headers
    )
    assert res.status_code == 503


async def test_authorize_returns_url_when_configured(client, auth_headers, google_configured):
    fid = await _create_family(client, auth_headers)
    res = await client.post(
        f"/api/v1/families/{fid}/external/google/authorize", headers=auth_headers
    )
    assert res.status_code == 200, res.text
    url = res.json()["authorize_url"]
    assert "client_id=test-client-id" in url and "state=" in url


# ── API: callback ────────────────────────────────────────────────────────────


def _patch_google_flow():
    """Patch the three live Google calls the callback makes."""

    async def _exchange(code):
        return google_oauth.GoogleTokens(
            access_token="ya29.at", refresh_token="1//rt", expires_in=3600, scope="readonly"
        )

    async def _email(token):
        return "household@gmail.com"

    async def _calendars(token):
        return [
            google_oauth.DiscoveredCalendar("primary", "Personal", "#4285f4"),
            google_oauth.DiscoveredCalendar("work@group.calendar.google.com", "Work", "#0b8043"),
        ]

    return (
        patch.object(google_oauth, "exchange_code", _exchange),
        patch.object(google_oauth, "fetch_account_email", _email),
        patch.object(google_oauth, "list_calendars", _calendars),
    )


async def test_callback_creates_account_and_discovers_calendars(
    client, auth_headers, session: AsyncSession
):
    fid = await _create_family(client, auth_headers)
    state = google_oauth.sign_state(uuid.UUID(fid))

    p1, p2, p3 = _patch_google_flow()
    with p1, p2, p3:
        res = await client.get(
            "/api/v1/external/google/callback", params={"state": state, "code": "abc"}
        )
    assert res.status_code == 303
    assert "external=connected" in res.headers["location"]

    accounts = (
        await session.execute(
            select(ExternalAccount).where(ExternalAccount.family_id == uuid.UUID(fid))
        )
    ).scalars().all()
    assert len(accounts) == 1
    assert accounts[0].provider == ExternalProvider.google
    assert accounts[0].account_email == "household@gmail.com"
    assert accounts[0].refresh_token == "1//rt"

    cal_count = await session.scalar(
        select(func.count()).select_from(ExternalCalendar).where(
            ExternalCalendar.account_id == accounts[0].id
        )
    )
    assert cal_count == 2


async def test_callback_reconnect_does_not_duplicate(
    client, auth_headers, session: AsyncSession
):
    fid = await _create_family(client, auth_headers)
    state = google_oauth.sign_state(uuid.UUID(fid))

    p1, p2, p3 = _patch_google_flow()
    with p1, p2, p3:
        await client.get(
            "/api/v1/external/google/callback", params={"state": state, "code": "abc"}
        )
        # Reconnect with a fresh state — same account + calendars, no dupes.
        await client.get(
            "/api/v1/external/google/callback",
            params={"state": google_oauth.sign_state(uuid.UUID(fid)), "code": "def"},
        )

    accounts = (
        await session.execute(
            select(ExternalAccount).where(ExternalAccount.family_id == uuid.UUID(fid))
        )
    ).scalars().all()
    assert len(accounts) == 1
    cal_count = await session.scalar(
        select(func.count()).select_from(ExternalCalendar)
    )
    assert cal_count == 2


async def test_callback_rejects_bad_state(client):
    res = await client.get(
        "/api/v1/external/google/callback", params={"state": "garbage", "code": "abc"}
    )
    assert res.status_code == 400


# ── API: list + disconnect + isolation ───────────────────────────────────────


async def test_list_and_disconnect_account(client, auth_headers, session: AsyncSession):
    fid = await _create_family(client, auth_headers)
    account = ExternalAccount(
        family_id=uuid.UUID(fid),
        provider=ExternalProvider.google,
        account_email="a@gmail.com",
    )
    session.add(account)
    await session.commit()

    listed = await client.get(
        f"/api/v1/families/{fid}/external/accounts", headers=auth_headers
    )
    assert listed.status_code == 200
    assert [a["account_email"] for a in listed.json()] == ["a@gmail.com"]

    deleted = await client.delete(
        f"/api/v1/families/{fid}/external/accounts/{account.id}", headers=auth_headers
    )
    assert deleted.status_code == 204

    after = await client.get(
        f"/api/v1/families/{fid}/external/accounts", headers=auth_headers
    )
    assert after.json() == []


async def test_timestamps_serialize_as_utc(client, auth_headers, session: AsyncSession):
    """SQLite drops tzinfo, so a naive UTC timestamp must still be serialised with
    an explicit offset — else the client reads a zone-less datetime as local time
    and the "Synced …" label shows the wrong zone."""
    fid = await _create_family(client, auth_headers)
    synced_at = datetime(2026, 1, 15, 18, 30, tzinfo=timezone.utc)
    account, ext_cal = await _connected_account(session, uuid.UUID(fid))
    ext_cal.last_synced_at = synced_at
    account.last_synced_at = synced_at
    await session.commit()

    res = await client.get(
        f"/api/v1/families/{fid}/external/accounts", headers=auth_headers
    )
    assert res.status_code == 200
    acc = res.json()[0]

    for value in (acc["last_synced_at"], acc["created_at"], acc["calendars"][0]["last_synced_at"]):
        parsed = datetime.fromisoformat(value)
        # Carries an explicit offset (not a naive, zone-less string)...
        assert parsed.tzinfo is not None, f"{value!r} has no timezone offset"
    # ...and the same instant, just labelled — not shifted.
    assert datetime.fromisoformat(acc["calendars"][0]["last_synced_at"]) == synced_at


async def test_disconnect_unknown_account_404(client, auth_headers):
    fid = await _create_family(client, auth_headers)
    res = await client.delete(
        f"/api/v1/families/{fid}/external/accounts/{uuid.uuid4()}", headers=auth_headers
    )
    assert res.status_code == 404


async def test_cannot_list_another_familys_accounts(
    client, auth_headers, session: AsyncSession, test_user: User
):
    # The test user owns family A.
    await _create_family(client, auth_headers, "A")

    # Family B has no membership for the test user.
    fam_b = Family(name="B")
    session.add(fam_b)
    await session.commit()

    res = await client.get(
        f"/api/v1/families/{fam_b.id}/external/accounts", headers=auth_headers
    )
    assert res.status_code == 403


# ── unit: Google event parsing ───────────────────────────────────────────────


def test_parse_event_timed_normalises_to_utc():
    ge = google_oauth.parse_event(
        {
            "id": "ev1",
            "iCalUID": "ev1@google.com",
            "status": "confirmed",
            "summary": "Standup",
            "location": "Zoom",
            "start": {"dateTime": "2026-06-15T09:00:00-07:00"},
            "end": {"dateTime": "2026-06-15T09:30:00-07:00"},
        }
    )
    assert ge.all_day is False
    assert ge.start_dt == datetime(2026, 6, 15, 16, 0, tzinfo=timezone.utc)
    assert ge.title == "Standup"
    assert ge.location == "Zoom"
    assert ge.rrule is None


def test_parse_event_all_day_and_rrule():
    ge = google_oauth.parse_event(
        {
            "id": "ev2",
            "status": "confirmed",
            "summary": "Trip",
            "start": {"date": "2026-07-01"},
            "end": {"date": "2026-07-05"},
            "recurrence": ["RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE;VALUE=DATE:20260706"],
        }
    )
    assert ge.all_day is True
    assert ge.start_dt == datetime(2026, 7, 1, 0, 0, tzinfo=timezone.utc)
    # Only the bare RRULE body is kept; EXDATE is dropped.
    assert ge.rrule == "FREQ=WEEKLY;BYDAY=MO"


def test_parse_event_cancelled_has_no_times():
    ge = google_oauth.parse_event({"id": "ev3", "status": "cancelled"})
    assert ge.status == "cancelled"
    assert ge.start_dt is None and ge.end_dt is None


def test_google_to_mirror_skips_recurring_instances():
    ge = google_oauth.GoogleEvent(
        external_id="i1", status="confirmed", ical_uid=None, title="x",
        description=None, location=None,
        start_dt=datetime(2026, 6, 15, tzinfo=timezone.utc),
        end_dt=datetime(2026, 6, 15, 1, tzinfo=timezone.utc),
        all_day=False, rrule=None, recurring_event_id="master1",
    )
    ext = ExternalCalendar(
        account_id=uuid.uuid4(), family_id=uuid.uuid4(), external_id="primary", name="P"
    )
    assert external_sync._google_to_mirror(ext, ge) is None


# ── mirror engine helpers ─────────────────────────────────────────────────────


def _ge_timed(eid: str, title: str = "Standup") -> google_oauth.GoogleEvent:
    return google_oauth.GoogleEvent(
        external_id=eid, status="confirmed", ical_uid=f"{eid}@google.com",
        title=title, description=None, location=None,
        start_dt=datetime(2026, 6, 15, 16, 0, tzinfo=timezone.utc),
        end_dt=datetime(2026, 6, 15, 16, 30, tzinfo=timezone.utc),
        all_day=False, rrule=None, recurring_event_id=None,
    )


def _ge_allday(eid: str, title: str = "Trip") -> google_oauth.GoogleEvent:
    return google_oauth.GoogleEvent(
        external_id=eid, status="confirmed", ical_uid=f"{eid}@google.com",
        title=title, description=None, location=None,
        start_dt=datetime(2026, 7, 1, tzinfo=timezone.utc),
        end_dt=datetime(2026, 7, 5, tzinfo=timezone.utc),
        all_day=True, rrule=None, recurring_event_id=None,
    )


def _ge_cancelled(eid: str) -> google_oauth.GoogleEvent:
    return google_oauth.GoogleEvent(
        external_id=eid, status="cancelled", ical_uid=None, title="",
        description=None, location=None, start_dt=None, end_dt=None,
        all_day=False, rrule=None, recurring_event_id=None,
    )


async def _connected_account(
    session: AsyncSession,
    family_id: uuid.UUID,
    *,
    synced: bool = True,
    token_expiry: datetime | None = None,
) -> tuple[ExternalAccount, ExternalCalendar]:
    """Seed a connected Google account with one discovered calendar (synced on by
    default). Tokens default to non-expired."""
    account = ExternalAccount(
        family_id=family_id,
        provider=ExternalProvider.google,
        account_email="household@gmail.com",
        access_token="at",
        refresh_token="rt",
        token_expiry=token_expiry or (datetime.now(timezone.utc) + timedelta(hours=1)),
        status=ExternalAccountStatus.active,
    )
    session.add(account)
    await session.flush()

    ext_cal = ExternalCalendar(
        account_id=account.id,
        family_id=family_id,
        external_id="primary",
        name="Personal",
        color="#4285f4",
        synced=synced,
    )
    session.add(ext_cal)
    await session.commit()
    return account, ext_cal


async def _reload_account(session: AsyncSession, account_id: uuid.UUID) -> ExternalAccount:
    """Re-fetch with calendars eager-loaded (the engine iterates them)."""
    return (
        await session.execute(
            select(ExternalAccount)
            .where(ExternalAccount.id == account_id)
            .options(selectinload(ExternalAccount.calendars))
        )
    ).scalar_one()


def _fetch_returning(page: google_oauth.EventsPage):
    async def _fetch(access_token, calendar_external_id, *, sync_token=None):
        return page

    return _fetch


# ── mirror engine ─────────────────────────────────────────────────────────────


async def test_sync_creates_mirrored_events(client, auth_headers, session: AsyncSession):
    fid = await _create_family(client, auth_headers)
    account, ext_cal = await _connected_account(session, uuid.UUID(fid))

    page = google_oauth.EventsPage(events=[_ge_timed("ev1"), _ge_allday("ev2")], next_sync_token="tok-1")
    acct = await _reload_account(session, account.id)
    with patch.object(google_oauth, "fetch_events", _fetch_returning(page)):
        counts = await external_sync.sync_account(acct, session)

    assert counts.created == 2
    assert counts.calendars == 1
    events = (
        await session.execute(select(Event).where(Event.external_calendar_id == ext_cal.id))
    ).scalars().all()
    assert len(events) == 2
    assert all(e.ical_uid.startswith("google:primary:") for e in events)

    refreshed = (
        await session.execute(select(ExternalCalendar).where(ExternalCalendar.id == ext_cal.id))
    ).scalar_one()
    assert refreshed.sync_token == "tok-1"
    assert refreshed.last_synced_at is not None


async def test_full_sync_reconciles_stale_mirror_rows(client, auth_headers, session: AsyncSession):
    """A full (reconciling) pull converges the mirror to the source: a row the
    snapshot no longer contains is soft-deleted. This is what clears the
    long-lived "duplicates" left by an earlier keying that re-sync couldn't remove."""
    fid = await _create_family(client, auth_headers)
    account, ext_cal = await _connected_account(session, uuid.UUID(fid))

    page1 = google_oauth.EventsPage(
        events=[_ge_timed("ev1"), _ge_timed("ev2", "Other")], next_sync_token="t1"
    )
    acct = await _reload_account(session, account.id)
    with patch.object(google_oauth, "fetch_events", _fetch_returning(page1)):
        await external_sync.sync_account(acct, session, force_full=True)

    # Source now only has ev1 — a full reconciling pull must drop the stale ev2.
    page2 = google_oauth.EventsPage(events=[_ge_timed("ev1")], next_sync_token="t2")
    acct = await _reload_account(session, account.id)
    with patch.object(google_oauth, "fetch_events", _fetch_returning(page2)):
        counts = await external_sync.sync_account(acct, session, force_full=True)

    assert counts.deleted == 1
    live = (
        await session.execute(
            select(Event).where(
                Event.external_calendar_id == ext_cal.id, Event.deleted_at.is_(None)
            )
        )
    ).scalars().all()
    assert {e.ical_uid for e in live} == {"google:primary:ev1"}


async def test_incremental_sync_keeps_rows_absent_from_the_delta(
    client, auth_headers, session: AsyncSession
):
    """Incremental pulls carry only changes, so an absent row means 'unchanged',
    not 'deleted' — reconcile must NOT run, or a delta would wipe the calendar."""
    fid = await _create_family(client, auth_headers)
    account, ext_cal = await _connected_account(session, uuid.UUID(fid))

    page1 = google_oauth.EventsPage(
        events=[_ge_timed("ev1"), _ge_timed("ev2", "Other")], next_sync_token="t1"
    )
    acct = await _reload_account(session, account.id)
    with patch.object(google_oauth, "fetch_events", _fetch_returning(page1)):
        await external_sync.sync_account(acct, session, force_full=True)

    # Background-style incremental pull (uses the stored token) with an empty delta.
    page2 = google_oauth.EventsPage(events=[], next_sync_token="t2")
    acct = await _reload_account(session, account.id)
    with patch.object(google_oauth, "fetch_events", _fetch_returning(page2)):
        counts = await external_sync.sync_account(acct, session)  # force_full=False

    assert counts.deleted == 0
    live = (
        await session.execute(
            select(Event).where(
                Event.external_calendar_id == ext_cal.id, Event.deleted_at.is_(None)
            )
        )
    ).scalars().all()
    assert len(live) == 2


async def test_full_sync_reconcile_respects_pull_window(
    client, auth_headers, session: AsyncSession
):
    """A full pull is window-bounded, so a one-off ending before the window is
    absent for a benign reason and must survive; a recurring master is always in
    a full pull, so its absence is a real deletion and it's reconciled away."""
    fid = await _create_family(client, auth_headers)
    account, ext_cal = await _connected_account(session, uuid.UUID(fid))
    fam = uuid.UUID(fid)

    old = datetime(2020, 1, 1, 9, 0, tzinfo=timezone.utc)
    session.add_all([
        Event(family_id=fam, external_calendar_id=ext_cal.id, title="Old one-off",
              start_dt=old, end_dt=old + timedelta(hours=1), ical_uid="google:primary:old"),
        Event(family_id=fam, external_calendar_id=ext_cal.id, title="Stale series",
              start_dt=old, end_dt=old + timedelta(hours=1), rrule="FREQ=WEEKLY",
              ical_uid="google:primary:series"),
    ])
    await session.commit()

    window = datetime(2026, 6, 1, tzinfo=timezone.utc)
    page = google_oauth.EventsPage(events=[], next_sync_token="t1", time_min=window)
    acct = await _reload_account(session, account.id)
    with patch.object(google_oauth, "fetch_events", _fetch_returning(page)):
        counts = await external_sync.sync_account(acct, session, force_full=True)

    assert counts.deleted == 1  # only the recurring master
    live = (
        await session.execute(
            select(Event).where(
                Event.external_calendar_id == ext_cal.id, Event.deleted_at.is_(None)
            )
        )
    ).scalars().all()
    assert {e.ical_uid for e in live} == {"google:primary:old"}


async def test_resync_endpoint_queues_full_reconcile(client, auth_headers, session: AsyncSession):
    """The "Clean up duplicates" endpoint returns 202 immediately and schedules a
    background full (reconciling) pull — the heavy work never blocks the request."""
    fid = await _create_family(client, auth_headers)
    account = ExternalAccount(
        family_id=uuid.UUID(fid),
        provider=ExternalProvider.apple,  # Apple skips the Google-config gate
        account_email="someone@icloud.com",
        refresh_token="app-specific-pw",
        status=ExternalAccountStatus.active,
    )
    session.add(account)
    await session.commit()

    with patch("app.routers.external._resync_account_bg", new=AsyncMock()) as bg:
        resp = await client.post(
            f"/api/v1/families/{fid}/external/accounts/{account.id}/resync",
            headers=auth_headers,
        )

    assert resp.status_code == 202, resp.text
    assert resp.json() == {"status": "started"}
    bg.assert_awaited_once_with(account.id)


async def test_resync_endpoint_404_for_unknown_account(client, auth_headers):
    fid = await _create_family(client, auth_headers)
    resp = await client.post(
        f"/api/v1/families/{fid}/external/accounts/{uuid.uuid4()}/resync",
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_cleanup_collapses_unlinked_duplicate_mirror_rows(
    client, auth_headers, session: AsyncSession
):
    """The catch-all dedup keeps one live copy and removes the unlinked leftovers
    the reconcile can't reach (read-only mirror rows the user can't delete)."""
    fid = await _create_family(client, auth_headers)
    _account, ext_cal = await _connected_account(session, uuid.UUID(fid))  # synced
    fam = uuid.UUID(fid)
    start = datetime(2026, 6, 5, 9, 0, tzinfo=timezone.utc)
    end = start + timedelta(hours=1)

    session.add_all([
        # The live copy — still linked to the synced calendar (must be kept).
        Event(family_id=fam, external_calendar_id=ext_cal.id, title="Pay tithing",
              start_dt=start, end_dt=end, ical_uid="google:primary:live"),
        # Two leftover copies the migration left unlinked (must be removed).
        Event(family_id=fam, external_calendar_id=None, title="Pay tithing",
              start_dt=start, end_dt=end, ical_uid="google:OLDURL:a"),
        Event(family_id=fam, external_calendar_id=None, title="Pay tithing",
              start_dt=start, end_dt=end, ical_uid="apple:OLDURL:b"),
        # A unique event — must be left alone.
        Event(family_id=fam, external_calendar_id=ext_cal.id, title="Solo",
              start_dt=start, end_dt=end, ical_uid="google:primary:solo"),
    ])
    await session.commit()

    removed = await external_sync.cleanup_duplicate_mirror_events(fam, session)
    assert removed == 2

    alive = (
        await session.execute(
            select(Event).where(Event.family_id == fam, Event.deleted_at.is_(None))
        )
    ).scalars().all()
    by_uid = {e.ical_uid for e in alive}
    assert "google:primary:live" in by_uid  # the live linked copy survived
    assert "google:primary:solo" in by_uid  # the unique event untouched
    assert len([e for e in alive if e.title == "Pay tithing"]) == 1


async def test_cleanup_leaves_toggled_off_calendar_events_alone(
    client, auth_headers, session: AsyncSession
):
    """Duplicates under a non-synced (hidden) calendar are not touched — toggling
    it back on must still show them; a full re-pull reconciles instead."""
    fid = await _create_family(client, auth_headers)
    _account, ext_cal = await _connected_account(session, uuid.UUID(fid), synced=False)
    fam = uuid.UUID(fid)
    start = datetime(2026, 6, 5, 9, 0, tzinfo=timezone.utc)
    end = start + timedelta(hours=1)
    session.add_all([
        Event(family_id=fam, external_calendar_id=ext_cal.id, title="Hidden",
              start_dt=start, end_dt=end, ical_uid="google:primary:a"),
        Event(family_id=fam, external_calendar_id=ext_cal.id, title="Hidden",
              start_dt=start, end_dt=end, ical_uid="google:primary:b"),
    ])
    await session.commit()

    removed = await external_sync.cleanup_duplicate_mirror_events(fam, session)
    assert removed == 0


async def test_cleanup_endpoint_returns_removed_count(
    client, auth_headers, session: AsyncSession
):
    fid = await _create_family(client, auth_headers)
    _account, ext_cal = await _connected_account(session, uuid.UUID(fid))
    fam = uuid.UUID(fid)
    start = datetime(2026, 6, 5, 9, 0, tzinfo=timezone.utc)
    end = start + timedelta(hours=1)
    session.add_all([
        Event(family_id=fam, external_calendar_id=ext_cal.id, title="Dupe",
              start_dt=start, end_dt=end, ical_uid="google:primary:keep"),
        Event(family_id=fam, external_calendar_id=None, title="Dupe",
              start_dt=start, end_dt=end, ical_uid="google:OLDURL:gone"),
    ])
    await session.commit()

    resp = await client.post(
        f"/api/v1/families/{fid}/external/cleanup-duplicates", headers=auth_headers
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"removed": 1}


async def test_sync_incremental_update_and_cancel(client, auth_headers, session: AsyncSession):
    fid = await _create_family(client, auth_headers)
    account, ext_cal = await _connected_account(session, uuid.UUID(fid))

    page1 = google_oauth.EventsPage([_ge_timed("ev1"), _ge_timed("ev2", "Lunch")], "tok-1")
    acct = await _reload_account(session, account.id)
    with patch.object(google_oauth, "fetch_events", _fetch_returning(page1)):
        await external_sync.sync_account(acct, session)

    # Incremental delta: ev1 edited, ev2 deleted upstream.
    page2 = google_oauth.EventsPage([_ge_timed("ev1", "Standup v2"), _ge_cancelled("ev2")], "tok-2")
    acct = await _reload_account(session, account.id)
    with patch.object(google_oauth, "fetch_events", _fetch_returning(page2)):
        counts = await external_sync.sync_account(acct, session)

    assert counts.updated == 1
    assert counts.deleted == 1
    live = (
        await session.execute(
            select(Event).where(Event.external_calendar_id == ext_cal.id, Event.deleted_at.is_(None))
        )
    ).scalars().all()
    assert [e.title for e in live] == ["Standup v2"]


async def test_sync_skips_unsynced_calendar(client, auth_headers, session: AsyncSession):
    fid = await _create_family(client, auth_headers)
    account, ext_cal = await _connected_account(session, uuid.UUID(fid), synced=False)

    async def _boom(*args, **kwargs):
        raise AssertionError("must not fetch an unmapped calendar")

    acct = await _reload_account(session, account.id)
    with patch.object(google_oauth, "fetch_events", _boom):
        counts = await external_sync.sync_account(acct, session)
    assert counts.calendars == 0 and counts.created == 0


async def test_sync_refreshes_expired_token(client, auth_headers, session: AsyncSession):
    fid = await _create_family(client, auth_headers)
    past = datetime.now(timezone.utc) - timedelta(minutes=5)
    account, _ext = await _connected_account(session, uuid.UUID(fid), token_expiry=past)

    new_tokens = google_oauth.GoogleTokens(
        access_token="ya29.new", refresh_token=None, expires_in=3600, scope="readonly"
    )

    async def _refresh(refresh_token):
        assert refresh_token == "rt"
        return new_tokens

    async def _fetch(access_token, calendar_external_id, *, sync_token=None):
        assert access_token == "ya29.new"  # the refreshed token is the one used
        return google_oauth.EventsPage([], "tok-1")

    acct = await _reload_account(session, account.id)
    with patch.object(google_oauth, "refresh_access_token", _refresh), patch.object(
        google_oauth, "fetch_events", _fetch
    ):
        await external_sync.sync_account(acct, session)

    refreshed = (
        await session.execute(select(ExternalAccount).where(ExternalAccount.id == account.id))
    ).scalar_one()
    assert refreshed.access_token == "ya29.new"
    assert refreshed.status == ExternalAccountStatus.active


async def test_sync_flags_needs_reauth_without_refresh_token(
    client, auth_headers, session: AsyncSession
):
    fid = await _create_family(client, auth_headers)
    past = datetime.now(timezone.utc) - timedelta(minutes=5)
    account, _ext = await _connected_account(session, uuid.UUID(fid), token_expiry=past)
    account.refresh_token = None
    await session.commit()

    acct = await _reload_account(session, account.id)
    with pytest.raises(google_oauth.GoogleOAuthError):
        await external_sync.sync_account(acct, session)

    refreshed = (
        await session.execute(select(ExternalAccount).where(ExternalAccount.id == account.id))
    ).scalar_one()
    assert refreshed.status == ExternalAccountStatus.needs_reauth


# ── API: enable / disable sync ──────────────────────────────────────────────────


async def test_enable_sync(client, auth_headers, session: AsyncSession):
    fid = await _create_family(client, auth_headers)
    _account, ext_cal = await _connected_account(session, uuid.UUID(fid), synced=False)

    res = await client.put(
        f"/api/v1/families/{fid}/external/calendars/{ext_cal.id}",
        json={"synced": True},
        headers=auth_headers,
    )
    assert res.status_code == 200, res.text
    assert res.json()["synced"] is True


async def test_disable_sync(client, auth_headers, session: AsyncSession):
    fid = await _create_family(client, auth_headers)
    _account, ext_cal = await _connected_account(session, uuid.UUID(fid), synced=True)

    res = await client.put(
        f"/api/v1/families/{fid}/external/calendars/{ext_cal.id}",
        json={"synced": False},
        headers=auth_headers,
    )
    assert res.status_code == 200, res.text
    assert res.json()["synced"] is False


async def test_set_sync_unknown_ext_calendar_404(client, auth_headers):
    fid = await _create_family(client, auth_headers)
    res = await client.put(
        f"/api/v1/families/{fid}/external/calendars/{uuid.uuid4()}",
        json={"synced": True},
        headers=auth_headers,
    )
    assert res.status_code == 404


async def test_update_calendar_color(client, auth_headers, session: AsyncSession):
    fid = await _create_family(client, auth_headers)
    _account, ext_cal = await _connected_account(session, uuid.UUID(fid), synced=True)

    res = await client.put(
        f"/api/v1/families/{fid}/external/calendars/{ext_cal.id}",
        json={"color": "#f0603f"},
        headers=auth_headers,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["color"] == "#f0603f"
    # A color-only update must leave the sync toggle alone (partial update).
    assert body["synced"] is True

    refreshed = await session.get(ExternalCalendar, ext_cal.id, populate_existing=True)
    assert refreshed is not None and refreshed.color == "#f0603f"


async def test_update_calendar_color_rejects_bad_hex(
    client, auth_headers, session: AsyncSession
):
    fid = await _create_family(client, auth_headers)
    _account, ext_cal = await _connected_account(session, uuid.UUID(fid), synced=True)

    res = await client.put(
        f"/api/v1/families/{fid}/external/calendars/{ext_cal.id}",
        json={"color": "not-a-color"},
        headers=auth_headers,
    )
    assert res.status_code == 422


# ── API: manual sync ──────────────────────────────────────────────────────────


async def test_manual_sync_endpoint_pulls_events(
    client, auth_headers, session: AsyncSession, google_configured
):
    fid = await _create_family(client, auth_headers)
    account, _ext = await _connected_account(session, uuid.UUID(fid))

    page = google_oauth.EventsPage([_ge_timed("ev1")], "tok-1")
    with patch.object(google_oauth, "fetch_events", _fetch_returning(page)):
        res = await client.post(
            f"/api/v1/families/{fid}/external/accounts/{account.id}/sync", headers=auth_headers
        )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["created"] == 1
    assert body["calendars_synced"] == 1
    assert body["status"] == "active"


async def test_manual_sync_503_when_unconfigured(client, auth_headers, session: AsyncSession):
    fid = await _create_family(client, auth_headers)
    account, _ext = await _connected_account(session, uuid.UUID(fid))
    res = await client.post(
        f"/api/v1/families/{fid}/external/accounts/{account.id}/sync", headers=auth_headers
    )
    assert res.status_code == 503


async def test_manual_sync_unknown_account_404(client, auth_headers, google_configured):
    fid = await _create_family(client, auth_headers)
    res = await client.post(
        f"/api/v1/families/{fid}/external/accounts/{uuid.uuid4()}/sync", headers=auth_headers
    )
    assert res.status_code == 404


# ══ F20 — Apple/iCloud (CalDAV) ════════════════════════════════════════════════


_PRINCIPAL_XML = """<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/</d:href><d:propstat><d:prop>
    <d:current-user-principal><d:href>/123456789/principal/</d:href></d:current-user-principal>
  </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>"""

_HOME_XML = """<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response><d:href>/123456789/principal/</d:href><d:propstat><d:prop>
    <c:calendar-home-set><d:href>/123456789/calendars/</d:href></c:calendar-home-set>
  </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>"""

_LIST_XML = """<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"
               xmlns:a="http://apple.com/ns/ical/">
  <d:response><d:href>/123456789/calendars/</d:href><d:propstat><d:prop>
    <d:resourcetype><d:collection/></d:resourcetype>
  </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
  <d:response><d:href>/123456789/calendars/home/</d:href><d:propstat><d:prop>
    <d:displayname>Home</d:displayname>
    <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
    <a:calendar-color>#FF2968FF</a:calendar-color>
    <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>
  </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
  <d:response><d:href>/123456789/calendars/tasks/</d:href><d:propstat><d:prop>
    <d:displayname>Reminders</d:displayname>
    <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
    <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>
  </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>"""

_SYNC_XML = """<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/123456789/calendars/home/e1.ics</d:href>
    <d:propstat><d:prop><d:getetag>"t1"</d:getetag>
      <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:e1
SUMMARY:Dentist
DTSTART:20260615T160000Z
DTEND:20260615T170000Z
END:VEVENT
END:VCALENDAR</c:calendar-data>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>/123456789/calendars/home/e2.ics</d:href>
    <d:status>HTTP/1.1 404 Not Found</d:status>
  </d:response>
  <d:sync-token>https://caldav.icloud.com/sync/TOKEN-2</d:sync-token>
</d:multistatus>"""


def _vcal(uid: str = "e1", summary: str = "Dentist") -> str:
    return "\r\n".join(
        [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//Test//EN",
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"SUMMARY:{summary}",
            "DTSTART:20260615T160000Z",
            "DTEND:20260615T170000Z",
            "END:VEVENT",
            "END:VCALENDAR",
        ]
    )


# ── unit: CalDAV client (mocked transport) ────────────────────────────────────


async def test_caldav_discover_parses_icloud():
    async def _fake_request(self, method, url, *, content=None, headers=None, **kw):
        body = content.decode() if isinstance(content, (bytes, bytearray)) else (content or "")
        if "current-user-principal" in body:
            xml = _PRINCIPAL_XML
        elif "calendar-home-set" in body:
            xml = _HOME_XML
        else:
            xml = _LIST_XML
        return httpx.Response(207, text=xml, request=httpx.Request(method, url))

    with patch("httpx.AsyncClient.request", _fake_request):
        cals = await caldav.discover_calendars("me@icloud.com", "app-pw")

    # Home-set collection (no <c:calendar/>) and the VTODO-only list are filtered.
    assert [c.name for c in cals] == ["Home"]
    assert cals[0].color == "#FF2968"  # #RRGGBBAA trimmed to #RRGGBB
    assert cals[0].external_id.endswith("/123456789/calendars/home/")


async def test_caldav_fetch_events_parses_sync_report():
    async def _fake_request(self, method, url, *, content=None, headers=None, **kw):
        return httpx.Response(207, text=_SYNC_XML, request=httpx.Request(method, url))

    with patch("httpx.AsyncClient.request", _fake_request):
        page = await caldav.fetch_events("https://x/home/", "me@icloud.com", "pw")

    assert page.next_sync_token == "https://caldav.icloud.com/sync/TOKEN-2"
    added = [r for r in page.resources if not r.deleted]
    removed = [r for r in page.resources if r.deleted]
    assert len(added) == 1 and len(removed) == 1
    assert "Dentist" in added[0].calendar_data


_SYNC_NO_DATA_XML = """<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/123456789/calendars/home/e1.ics</d:href>
    <d:propstat><d:prop><d:getetag>"t1"</d:getetag></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>/123456789/calendars/home/e2.ics</d:href>
    <d:status>HTTP/1.1 404 Not Found</d:status>
  </d:response>
  <d:sync-token>https://caldav.icloud.com/sync/TOKEN-3</d:sync-token>
</d:multistatus>"""

_MULTIGET_XML = """<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/123456789/calendars/home/e1.ics</d:href>
    <d:propstat><d:prop><d:getetag>"t1"</d:getetag>
      <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:e1
SUMMARY:Dentist
DTSTART:20260615T160000Z
DTEND:20260615T170000Z
END:VEVENT
END:VCALENDAR</c:calendar-data>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
</d:multistatus>"""


async def test_caldav_fetch_events_multiget_fallback_for_icloud():
    """iCloud's sync-collection lists changed hrefs but omits the event bodies, so
    fetch_events must follow up with a calendar-multiget to pull calendar-data —
    otherwise every event is skipped downstream and nothing mirrors."""
    seen: list[str] = []

    async def _fake_request(self, method, url, *, content=None, headers=None, **kw):
        body = content.decode() if isinstance(content, (bytes, bytearray)) else (content or "")
        if "sync-collection" in body:
            seen.append("sync")
            return httpx.Response(207, text=_SYNC_NO_DATA_XML, request=httpx.Request(method, url))
        # Only the live href is requested — the 404'd resource is never multi-got.
        assert "calendar-multiget" in body
        assert "/123456789/calendars/home/e1.ics" in body
        assert "e2.ics" not in body
        seen.append("multiget")
        return httpx.Response(207, text=_MULTIGET_XML, request=httpx.Request(method, url))

    with patch("httpx.AsyncClient.request", _fake_request):
        page = await caldav.fetch_events("https://x/home/", "me@icloud.com", "pw")

    assert seen == ["sync", "multiget"]  # the follow-up actually happened
    assert page.next_sync_token == "https://caldav.icloud.com/sync/TOKEN-3"
    added = [r for r in page.resources if not r.deleted]
    removed = [r for r in page.resources if r.deleted]
    assert len(added) == 1 and len(removed) == 1
    assert "Dentist" in added[0].calendar_data  # body filled in by the multiget


async def test_caldav_fetch_401_raises_auth_error():
    async def _fake_request(self, method, url, *, content=None, headers=None, **kw):
        return httpx.Response(401, text="", request=httpx.Request(method, url))

    with patch("httpx.AsyncClient.request", _fake_request):
        with pytest.raises(caldav.CalDavAuthError):
            await caldav.fetch_events("https://x/home/", "me@icloud.com", "pw")


# ── API: Apple connect ─────────────────────────────────────────────────────────


def _patch_apple_discovery():
    async def _discover(username, password, *, base_url=None):
        return [
            caldav.DiscoveredCalendar(
                "https://p01-caldav.icloud.com/1/calendars/home/", "Home", "#FF2968"
            ),
            caldav.DiscoveredCalendar(
                "https://p01-caldav.icloud.com/1/calendars/work/", "Work", "#34AADC"
            ),
        ]

    return patch.object(caldav, "discover_calendars", _discover)


async def test_apple_connect_creates_account(client, auth_headers):
    fid = await _create_family(client, auth_headers)
    with _patch_apple_discovery():
        res = await client.post(
            f"/api/v1/families/{fid}/external/apple/connect",
            json={"apple_id": "me@icloud.com", "app_password": "abcd-efgh-ijkl-mnop"},
            headers=auth_headers,
        )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["provider"] == "apple"
    assert body["account_email"] == "me@icloud.com"
    assert len(body["calendars"]) == 2


async def test_apple_connect_rejects_bad_credentials(client, auth_headers):
    fid = await _create_family(client, auth_headers)

    async def _bad(username, password, *, base_url=None):
        raise caldav.CalDavAuthError("rejected")

    with patch.object(caldav, "discover_calendars", _bad):
        res = await client.post(
            f"/api/v1/families/{fid}/external/apple/connect",
            json={"apple_id": "me@icloud.com", "app_password": "wrong"},
            headers=auth_headers,
        )
    assert res.status_code == 401


async def test_apple_connect_reconnect_no_duplicate(client, auth_headers):
    fid = await _create_family(client, auth_headers)
    payload = {"apple_id": "me@icloud.com", "app_password": "abcd-efgh-ijkl-mnop"}
    with _patch_apple_discovery():
        await client.post(
            f"/api/v1/families/{fid}/external/apple/connect", json=payload, headers=auth_headers
        )
        await client.post(
            f"/api/v1/families/{fid}/external/apple/connect", json=payload, headers=auth_headers
        )

    listed = await client.get(f"/api/v1/families/{fid}/external/accounts", headers=auth_headers)
    apple = [a for a in listed.json() if a["provider"] == "apple"]
    assert len(apple) == 1
    assert len(apple[0]["calendars"]) == 2


# ── Subscribed ICS feed (F25) ─────────────────────────────────────────────────

_HOLIDAYS_ICS = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Holidays//EN
X-WR-CALNAME:US Holidays
BEGIN:VEVENT
UID:newyear-2026@holidays
DTSTART;VALUE=DATE:20260101
DTEND;VALUE=DATE:20260102
SUMMARY:New Year's Day
END:VEVENT
BEGIN:VEVENT
UID:independence-2026@holidays
DTSTART;VALUE=DATE:20260704
DTEND;VALUE=DATE:20260705
SUMMARY:Independence Day
END:VEVENT
END:VCALENDAR
"""

# Same feed a year later: New Year's drops out of the window, a new holiday appears.
_HOLIDAYS_ICS_NEXT = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Holidays//EN
X-WR-CALNAME:US Holidays
BEGIN:VEVENT
UID:independence-2026@holidays
DTSTART;VALUE=DATE:20260704
DTEND;VALUE=DATE:20260705
SUMMARY:Independence Day
END:VEVENT
BEGIN:VEVENT
UID:newyear-2027@holidays
DTSTART;VALUE=DATE:20270101
DTEND;VALUE=DATE:20270102
SUMMARY:New Year's Day
END:VEVENT
END:VCALENDAR
"""

_FEED_URL = "https://example.com/us-holidays.ics"


def _fetch_feed_returning(text: str):
    async def _fetch(url):
        return text

    return _fetch


async def _connected_ics_feed(
    session: AsyncSession, family_id: uuid.UUID, *, url: str = _FEED_URL, synced: bool = True
) -> tuple[ExternalAccount, ExternalCalendar]:
    """Seed a family's ICS container account with one subscribed feed (synced on)."""
    account = ExternalAccount(
        family_id=family_id,
        provider=ExternalProvider.ics,
        account_email="Subscribed feeds",
        status=ExternalAccountStatus.active,
    )
    session.add(account)
    await session.flush()
    ext_cal = ExternalCalendar(
        account_id=account.id,
        family_id=family_id,
        external_id=url,
        name="US Holidays",
        color="#FF0000",
        synced=synced,
    )
    session.add(ext_cal)
    await session.commit()
    return account, ext_cal


# unit: URL normalisation


def test_normalize_feed_url_rewrites_webcal():
    assert ics_feed.normalize_feed_url("webcal://x.test/a.ics") == "https://x.test/a.ics"
    assert ics_feed.normalize_feed_url("webcals://x.test/a.ics") == "https://x.test/a.ics"
    assert ics_feed.normalize_feed_url("  https://x.test/a.ics ") == "https://x.test/a.ics"


def test_feed_name_reads_calname():
    assert ics_feed.feed_name(_HOLIDAYS_ICS) == "US Holidays"
    assert ics_feed.feed_name("not a calendar") is None


# connect endpoint


async def test_ics_connect_subscribes_and_queues_pull(client, auth_headers):
    fid = await _create_family(client, auth_headers)
    with patch.object(ics_feed, "fetch_feed", _fetch_feed_returning(_HOLIDAYS_ICS)), patch(
        "app.routers.external._resync_account_bg", new=AsyncMock()
    ) as bg:
        res = await client.post(
            f"/api/v1/families/{fid}/external/ics/connect",
            json={"url": "webcal://example.com/us-holidays.ics"},
            headers=auth_headers,
        )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["provider"] == "ics"
    assert len(body["calendars"]) == 1
    cal = body["calendars"][0]
    assert cal["synced"] is True
    assert cal["external_id"] == _FEED_URL  # webcal:// normalised to https
    assert cal["name"] == "US Holidays"  # defaulted from X-WR-CALNAME
    bg.assert_awaited_once()  # an immediate background pull was queued


async def test_ics_connect_rejects_unfetchable_feed(client, auth_headers):
    fid = await _create_family(client, auth_headers)

    async def _boom(url):
        raise ics_feed.IcsFeedError("dns")

    with patch.object(ics_feed, "fetch_feed", _boom), patch(
        "app.routers.external._resync_account_bg", new=AsyncMock()
    ):
        res = await client.post(
            f"/api/v1/families/{fid}/external/ics/connect",
            json={"url": "https://nope.test/x.ics"},
            headers=auth_headers,
        )
    assert res.status_code == 502


async def test_ics_connect_rejects_non_calendar(client, auth_headers):
    fid = await _create_family(client, auth_headers)
    with patch.object(ics_feed, "fetch_feed", _fetch_feed_returning("<html>nope</html>")), patch(
        "app.routers.external._resync_account_bg", new=AsyncMock()
    ):
        res = await client.post(
            f"/api/v1/families/{fid}/external/ics/connect",
            json={"url": "https://example.com/page.html"},
            headers=auth_headers,
        )
    assert res.status_code == 400


async def test_ics_connect_rejects_bad_scheme(client, auth_headers):
    fid = await _create_family(client, auth_headers)
    res = await client.post(
        f"/api/v1/families/{fid}/external/ics/connect",
        json={"url": "ftp://example.com/x.ics"},
        headers=auth_headers,
    )
    assert res.status_code == 422  # rejected by the schema validator


async def test_ics_connect_resubscribe_no_duplicate(client, auth_headers):
    fid = await _create_family(client, auth_headers)
    payload = {"url": "https://example.com/us-holidays.ics"}
    with patch.object(ics_feed, "fetch_feed", _fetch_feed_returning(_HOLIDAYS_ICS)), patch(
        "app.routers.external._resync_account_bg", new=AsyncMock()
    ):
        await client.post(
            f"/api/v1/families/{fid}/external/ics/connect", json=payload, headers=auth_headers
        )
        await client.post(
            f"/api/v1/families/{fid}/external/ics/connect", json=payload, headers=auth_headers
        )
    listed = await client.get(f"/api/v1/families/{fid}/external/accounts", headers=auth_headers)
    ics_accts = [a for a in listed.json() if a["provider"] == "ics"]
    assert len(ics_accts) == 1  # one container account
    assert len(ics_accts[0]["calendars"]) == 1  # one feed, not two


# sync engine


async def test_ics_sync_mirrors_feed_events(client, auth_headers, session: AsyncSession):
    fid = await _create_family(client, auth_headers)
    account, ext_cal = await _connected_ics_feed(session, uuid.UUID(fid))

    acct = await _reload_account(session, account.id)
    with patch.object(ics_feed, "fetch_feed", _fetch_feed_returning(_HOLIDAYS_ICS)):
        counts = await external_sync.sync_account(acct, session)

    assert counts.created == 2
    assert counts.calendars == 1
    events = (
        await session.execute(select(Event).where(Event.external_calendar_id == ext_cal.id))
    ).scalars().all()
    assert len(events) == 2
    assert all(e.ical_uid.startswith(f"ics:{_FEED_URL}:") for e in events)
    assert all(e.all_day for e in events)
    # Mirrored feed events are read-only (the UI must not let them be edited).
    assert all(is_external_mirror(e.ical_uid) for e in events)


async def test_ics_resync_is_idempotent(client, auth_headers, session: AsyncSession):
    """Re-fetching the same feed updates rows in place — no duplicates."""
    fid = await _create_family(client, auth_headers)
    account, ext_cal = await _connected_ics_feed(session, uuid.UUID(fid))

    acct = await _reload_account(session, account.id)
    with patch.object(ics_feed, "fetch_feed", _fetch_feed_returning(_HOLIDAYS_ICS)):
        await external_sync.sync_account(acct, session)
        counts2 = await external_sync.sync_account(acct, session)

    assert counts2.created == 0
    assert counts2.updated == 2
    live = (
        await session.execute(
            select(func.count())
            .select_from(Event)
            .where(Event.external_calendar_id == ext_cal.id, Event.deleted_at.is_(None))
        )
    ).scalar_one()
    assert live == 2


async def test_ics_sync_reconciles_dropped_events(client, auth_headers, session: AsyncSession):
    """Every feed pull is a full snapshot, so a holiday that rolls out of the feed
    window is soft-deleted and a newly-added one is created — automatically, with
    no re-import. This is what makes next year's holidays appear on their own."""
    fid = await _create_family(client, auth_headers)
    account, ext_cal = await _connected_ics_feed(session, uuid.UUID(fid))

    acct = await _reload_account(session, account.id)
    with patch.object(ics_feed, "fetch_feed", _fetch_feed_returning(_HOLIDAYS_ICS)):
        await external_sync.sync_account(acct, session)
    with patch.object(ics_feed, "fetch_feed", _fetch_feed_returning(_HOLIDAYS_ICS_NEXT)):
        counts = await external_sync.sync_account(acct, session)

    assert counts.created == 1  # New Year's 2027
    assert counts.deleted == 1  # New Year's 2026 dropped out of the feed
    titles = {
        e.title
        for e in (
            await session.execute(
                select(Event).where(
                    Event.external_calendar_id == ext_cal.id, Event.deleted_at.is_(None)
                )
            )
        ).scalars().all()
    }
    assert titles == {"Independence Day", "New Year's Day"}


async def test_ics_sync_empty_feed_does_not_wipe_mirror(
    client, auth_headers, session: AsyncSession
):
    """A transient empty/garbled fetch must not soft-delete every mirrored event."""
    fid = await _create_family(client, auth_headers)
    account, ext_cal = await _connected_ics_feed(session, uuid.UUID(fid))

    acct = await _reload_account(session, account.id)
    with patch.object(ics_feed, "fetch_feed", _fetch_feed_returning(_HOLIDAYS_ICS)):
        await external_sync.sync_account(acct, session)
    # Feed comes back with no VEVENTs — treat as a glitch, keep what we have.
    empty = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Test//EN\nEND:VCALENDAR\n"
    with patch.object(ics_feed, "fetch_feed", _fetch_feed_returning(empty)):
        counts = await external_sync.sync_account(acct, session)

    assert counts.deleted == 0
    live = (
        await session.execute(
            select(func.count())
            .select_from(Event)
            .where(Event.external_calendar_id == ext_cal.id, Event.deleted_at.is_(None))
        )
    ).scalar_one()
    assert live == 2


# ── Apple mirror engine ────────────────────────────────────────────────────────


async def _connected_apple_account(
    session: AsyncSession, family_id: uuid.UUID
) -> tuple[ExternalAccount, ExternalCalendar]:
    account = ExternalAccount(
        family_id=family_id,
        provider=ExternalProvider.apple,
        account_email="me@icloud.com",
        refresh_token="app-pw",  # the app-specific password (durable credential)
        status=ExternalAccountStatus.active,
    )
    session.add(account)
    await session.flush()
    ext_cal = ExternalCalendar(
        account_id=account.id,
        family_id=family_id,
        external_id="https://p01-caldav.icloud.com/1/calendars/home/",
        name="Home",
        color="#FF2968",
        synced=True,
    )
    session.add(ext_cal)
    await session.commit()
    return account, ext_cal


async def test_apple_sync_mirrors_caldav_events(client, auth_headers, session: AsyncSession):
    fid = await _create_family(client, auth_headers)
    account, ext_cal = await _connected_apple_account(session, uuid.UUID(fid))

    page = caldav.CalDavPage(
        resources=[
            caldav.CalDavResource(href="home/e1.ics", deleted=False, calendar_data=_vcal("e1")),
            caldav.CalDavResource(href="home/e2.ics", deleted=True, calendar_data=None),
        ],
        next_sync_token="TOK-1",
    )

    async def _fetch(calendar_url, username, password, *, sync_token=None):
        assert username == "me@icloud.com" and password == "app-pw"
        return page

    acct = await _reload_account(session, account.id)
    with patch.object(caldav, "fetch_events", _fetch):
        counts = await external_sync.sync_account(acct, session)

    assert counts.created == 1
    assert counts.calendars == 1
    events = (
        await session.execute(
            select(Event).where(Event.external_calendar_id == ext_cal.id, Event.deleted_at.is_(None))
        )
    ).scalars().all()
    assert [e.title for e in events] == ["Dentist"]
    assert events[0].ical_uid.startswith("apple:https://p01-caldav.icloud.com/1/calendars/home/:")

    refreshed = (
        await session.execute(select(ExternalCalendar).where(ExternalCalendar.id == ext_cal.id))
    ).scalar_one()
    assert refreshed.sync_token == "TOK-1"


async def test_apple_sync_auth_failure_flags_reauth(client, auth_headers, session: AsyncSession):
    fid = await _create_family(client, auth_headers)
    account, _ext = await _connected_apple_account(session, uuid.UUID(fid))

    async def _fetch(*args, **kwargs):
        raise caldav.CalDavAuthError("expired app password")

    acct = await _reload_account(session, account.id)
    with patch.object(caldav, "fetch_events", _fetch):
        with pytest.raises(caldav.CalDavAuthError):
            await external_sync.sync_account(acct, session)

    refreshed = (
        await session.execute(select(ExternalAccount).where(ExternalAccount.id == account.id))
    ).scalar_one()
    assert refreshed.status == ExternalAccountStatus.needs_reauth
