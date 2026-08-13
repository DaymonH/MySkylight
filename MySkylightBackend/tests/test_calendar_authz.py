"""Family-scoping for the calendar/event surface.

Companion to test_authz.py (which only covers /members). These assert that the
events / occurrences endpoints reject cross-family access, that under-privileged
roles can't mutate, and — the subtle one — that an event mutation can't smuggle
in *another* family's member (which would leak that member into this family's
occurrence output).

Auth swapping follows the test_authz.py / test_invitations.py pattern: the
autouse `patch_clerk_verify` fixture authenticates as `test_user`; we override
the verify dependency mid-test to act as a different Clerk user.
"""

import uuid

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

import app.deps as deps_module
from app.main import app
from app.models.family import Membership, MembershipRole
from app.models.user import User

API = "/api/v1"


def _auth_as(clerk_user_id: str) -> None:
    async def _verify(request: Request) -> str:  # request must be typed (see conftest note)
        return clerk_user_id

    app.dependency_overrides[deps_module.verify_clerk_token] = _verify


async def _make_user(session: AsyncSession, clerk_id: str, email: str) -> User:
    user = User(clerk_user_id=clerk_id, email=email)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _family(client, headers, name: str = "Fam") -> str:
    r = await client.post(f"{API}/families", json={"name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _owner_member_id(client, headers, family_id: str) -> str:
    r = await client.get(f"{API}/families/{family_id}/members", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()[0]["id"]


def _event_body(**over) -> dict:
    body = {
        "title": "Picnic",
        "start_dt": "2026-06-20T09:00:00+00:00",
        "end_dt": "2026-06-20T10:00:00+00:00",
    }
    body.update(over)
    return body


# ── Cross-family access ────────────────────────────────────────────────────────


async def test_non_member_cannot_access_calendar_surface(
    client, auth_headers, session: AsyncSession, test_user: User
):
    fam_a = await _family(client, auth_headers, "Family A")

    stranger = await _make_user(session, "user_stranger_cal", "stranger-cal@example.com")
    _auth_as(stranger.clerk_user_id)

    assert (
        await client.get(f"{API}/families/{fam_a}/events", headers=auth_headers)
    ).status_code == 403
    occ = await client.get(
        f"{API}/families/{fam_a}/events/occurrences?from=2026-06-01&to=2026-06-30",
        headers=auth_headers,
    )
    assert occ.status_code == 403
    created = await client.post(
        f"{API}/families/{fam_a}/events", json=_event_body(), headers=auth_headers
    )
    assert created.status_code == 403


async def test_viewer_cannot_mutate_events(
    client, auth_headers, session: AsyncSession, test_user: User
):
    fam = await _family(client, auth_headers, "Viewer Fam")

    viewer = await _make_user(session, "user_viewer_cal", "viewer-cal@example.com")
    session.add(
        Membership(user_id=viewer.id, family_id=uuid.UUID(fam), role=MembershipRole.viewer)
    )
    await session.commit()
    _auth_as(viewer.clerk_user_id)

    # A viewer may read…
    assert (
        await client.get(f"{API}/families/{fam}/events", headers=auth_headers)
    ).status_code == 200
    # …but not create (FamilyOwnerOrAdult) — rejected on role, not membership.
    created = await client.post(
        f"{API}/families/{fam}/events", json=_event_body(), headers=auth_headers
    )
    assert created.status_code == 403
    assert created.json()["detail"] == "Insufficient role"


# ── Cross-family smuggling via member_ids ───────────────────────────────────────


async def test_cannot_assign_member_from_another_family(
    client, auth_headers, session: AsyncSession, test_user: User
):
    fam_a = await _family(client, auth_headers, "Family A")
    own_member = await _owner_member_id(client, auth_headers, fam_a)

    # A second family owned by a different user, with its own member.
    other = await _make_user(session, "user_other_owner", "other@example.com")
    _auth_as(other.clerk_user_id)
    fam_b = await _family(client, auth_headers, "Family B")
    foreign_member = await _owner_member_id(client, auth_headers, fam_b)

    # Back to Family A's owner. Assigning Family B's member must be rejected.
    _auth_as(test_user.clerk_user_id)
    created = await client.post(
        f"{API}/families/{fam_a}/events",
        json=_event_body(member_ids=[foreign_member]),
        headers=auth_headers,
    )
    assert created.status_code == 400, created.text

    # Same protection on the PATCH path: start from a legit event…
    ev = await client.post(
        f"{API}/families/{fam_a}/events",
        json=_event_body(member_ids=[own_member]),
        headers=auth_headers,
    )
    assert ev.status_code == 201, ev.text
    event_id = ev.json()["id"]
    patched = await client.patch(
        f"{API}/families/{fam_a}/events/{event_id}",
        json={"member_ids": [foreign_member]},
        headers=auth_headers,
    )
    assert patched.status_code == 400, patched.text
