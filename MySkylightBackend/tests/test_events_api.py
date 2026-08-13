"""HTTP-level tests for the events API: assignment, validation, occurrences."""

import uuid
from datetime import datetime, timezone

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.calendar import Event
from app.models.external import ExternalAccount, ExternalCalendar, ExternalProvider

API = "/api/v1"


async def _family(client: AsyncClient, auth_headers) -> str:
    r = await client.post(f"{API}/families", json={"name": "Fam"}, headers=auth_headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_event_end_before_start_is_rejected(client: AsyncClient, auth_headers):
    family_id = await _family(client, auth_headers)
    r = await client.post(
        f"{API}/families/{family_id}/events",
        json={
            "title": "Backwards",
            "start_dt": "2026-06-20T10:00:00+00:00",
            "end_dt": "2026-06-20T09:00:00+00:00",
        },
        headers=auth_headers,
    )
    assert r.status_code == 422, r.text


async def test_negative_reminder_is_rejected(client: AsyncClient, auth_headers):
    family_id = await _family(client, auth_headers)
    r = await client.post(
        f"{API}/families/{family_id}/events",
        json={
            "title": "Bad reminder",
            "start_dt": "2026-06-20T09:00:00+00:00",
            "end_dt": "2026-06-20T10:00:00+00:00",
            "reminder_minutes": [-5],
        },
        headers=auth_headers,
    )
    assert r.status_code == 422, r.text


async def test_occurrences_endpoint_returns_event(client: AsyncClient, auth_headers):
    family_id = await _family(client, auth_headers)
    created = await client.post(
        f"{API}/families/{family_id}/events",
        json={
            "title": "Picnic",
            "start_dt": "2026-06-20T09:00:00+00:00",
            "end_dt": "2026-06-20T10:00:00+00:00",
        },
        headers=auth_headers,
    )
    assert created.status_code == 201, created.text

    r = await client.get(
        f"{API}/families/{family_id}/events/occurrences?from=2026-06-01&to=2026-06-30",
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert "Picnic" in [o["title"] for o in r.json()]


async def test_occurrences_window_too_large_is_rejected(client: AsyncClient, auth_headers):
    family_id = await _family(client, auth_headers)
    # > 400-day span: unbounded recurrence expansion is refused, not silently run.
    r = await client.get(
        f"{API}/families/{family_id}/events/occurrences?from=2026-01-01&to=2030-01-01",
        headers=auth_headers,
    )
    assert r.status_code == 400, r.text


async def test_occurrences_inverted_window_is_rejected(client: AsyncClient, auth_headers):
    family_id = await _family(client, auth_headers)
    r = await client.get(
        f"{API}/families/{family_id}/events/occurrences?from=2026-06-30&to=2026-06-01",
        headers=auth_headers,
    )
    assert r.status_code == 400, r.text


async def test_add_member_to_unassigned_event(client: AsyncClient, auth_headers):
    # 1) Family (auto-creates owner Membership + Member)
    r = await client.post(f"{API}/families", json={"name": "Repro Fam"}, headers=auth_headers)
    assert r.status_code == 201, r.text
    family_id = r.json()["id"]

    # 2) The owner's auto-created member
    r = await client.get(f"{API}/families/{family_id}/members", headers=auth_headers)
    assert r.status_code == 200, r.text
    members = r.json()
    assert members, "expected an auto-created owner member"
    member_id = members[0]["id"]

    # 3) Event with NO assignment
    r = await client.post(
        f"{API}/families/{family_id}/events",
        json={
            "title": "Unassigned event",
            "start_dt": "2026-06-20T09:00:00+00:00",
            "end_dt": "2026-06-20T10:00:00+00:00",
            "member_ids": [],
            "reminder_minutes": [],
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    event_id = r.json()["id"]

    # 4) PATCH to add a member — exactly what the edit sheet sends
    r = await client.patch(
        f"{API}/families/{family_id}/events/{event_id}",
        json={
            "title": "Unassigned event",
            "start_dt": "2026-06-20T09:00:00+00:00",
            "end_dt": "2026-06-20T10:00:00+00:00",
            "all_day": False,
            "is_countdown": False,
            "member_ids": [member_id],
            "reminder_minutes": [],
            "edit_mode": "all",
        },
        headers=auth_headers,
    )
    assert r.status_code == 200, f"PATCH failed {r.status_code}: {r.text}"
    assert [m["id"] for m in r.json()["members"]] == [member_id], r.json()


# ── Read-only external-mirror events (F18/F20) ──────────────────────────────────
# Events pulled from a connected Google/Apple calendar land as ordinary Event rows
# carrying a provider-namespaced ical_uid and pointing at their ExternalCalendar.
# The API must mark them read-only and refuse edits/deletes so the next sync never
# clobbers a local change.

async def _seed_mirror_event(
    session: AsyncSession,
    family_id: str,
    *,
    uid: str = "google:primary:evt-1",
    title: str = "Mirrored standup",
) -> str:
    """Insert an event straight into the DB as the pull engine would — linked to a
    synced ExternalCalendar and carrying a provider-prefixed ical_uid the events
    API never lets a client set itself."""
    fam = uuid.UUID(family_id)
    account = ExternalAccount(family_id=fam, provider=ExternalProvider.google)
    session.add(account)
    await session.flush()
    ext_cal = ExternalCalendar(
        account_id=account.id, family_id=fam, external_id="primary",
        name="Primary", synced=True,
    )
    session.add(ext_cal)
    await session.flush()
    event = Event(
        family_id=fam,
        external_calendar_id=ext_cal.id,
        title=title,
        start_dt=datetime(2026, 6, 20, 9, tzinfo=timezone.utc),
        end_dt=datetime(2026, 6, 20, 10, tzinfo=timezone.utc),
        ical_uid=uid,
    )
    session.add(event)
    await session.commit()
    return str(event.id)


async def test_occurrence_read_only_flag_distinguishes_mirror_from_native(
    client: AsyncClient, auth_headers, session: AsyncSession
):
    family_id = await _family(client, auth_headers)
    await _seed_mirror_event(session, family_id, title="From Google")
    # A normal, app-created event stays editable.
    created = await client.post(
        f"{API}/families/{family_id}/events",
        json={
            "title": "Native picnic",
            "start_dt": "2026-06-21T09:00:00+00:00",
            "end_dt": "2026-06-21T10:00:00+00:00",
        },
        headers=auth_headers,
    )
    assert created.status_code == 201, created.text

    r = await client.get(
        f"{API}/families/{family_id}/events/occurrences?from=2026-06-01&to=2026-06-30",
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    by_title = {o["title"]: o for o in r.json()}
    assert by_title["From Google"]["read_only"] is True
    assert by_title["Native picnic"]["read_only"] is False


async def test_patch_external_mirror_event_is_forbidden(
    client: AsyncClient, auth_headers, session: AsyncSession
):
    family_id = await _family(client, auth_headers)
    event_id = await _seed_mirror_event(session, family_id, uid="apple:home:abc")

    r = await client.patch(
        f"{API}/families/{family_id}/events/{event_id}",
        json={"title": "Hijacked", "edit_mode": "all"},
        headers=auth_headers,
    )
    assert r.status_code == 403, r.text


async def test_delete_external_mirror_event_is_forbidden(
    client: AsyncClient, auth_headers, session: AsyncSession
):
    family_id = await _family(client, auth_headers)
    event_id = await _seed_mirror_event(session, family_id)

    r = await client.delete(
        f"{API}/families/{family_id}/events/{event_id}",
        headers=auth_headers,
    )
    assert r.status_code == 403, r.text
