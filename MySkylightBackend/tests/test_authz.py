"""Family-scoped authorization (the `require_family_role` dependency in `app/deps.py`).

Two guarantees, both security-critical:
  1. Cross-family rejection — a valid login that is *not a member* of a family gets
     403 on that family's data (read and write alike).
  2. In-family role rejection — an under-privileged role (viewer) can read but is
     refused owner/adult-only mutations.

The conftest autouse fixture authenticates every request as `test_user`; we swap the
verify dependency mid-test (à la `test_invitations._accept_as`) to act as other users.
"""

import uuid

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

import app.deps as deps_module
from app.main import app
from app.models.family import Membership, MembershipRole
from app.models.user import User


def _auth_as(clerk_user_id: str) -> None:
    """Swap the auth dependency so the next request is the given Clerk user."""

    async def _verify(request: Request) -> str:  # request must be typed (see conftest note)
        return clerk_user_id

    app.dependency_overrides[deps_module.verify_clerk_token] = _verify


async def _make_user(session: AsyncSession, clerk_id: str, email: str) -> User:
    user = User(clerk_user_id=clerk_id, email=email)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _create_family(client, auth_headers, name: str) -> str:
    resp = await client.post("/api/v1/families", json={"name": name}, headers=auth_headers)
    assert resp.status_code == 201
    return resp.json()["id"]


async def test_non_member_cannot_access_another_family(
    client, auth_headers, session: AsyncSession, test_user: User
):
    # test_user (default auth) owns Family A.
    family_a = await _create_family(client, auth_headers, "Family A")

    # A stranger: real login, but no membership anywhere.
    stranger = await _make_user(session, "user_stranger", "stranger@example.com")
    _auth_as(stranger.clerk_user_id)

    # Reads are refused…
    listed = await client.get(f"/api/v1/families/{family_a}/members", headers=auth_headers)
    assert listed.status_code == 403
    assert listed.json()["detail"] == "Not a member of this family"

    # …and so are writes.
    created = await client.post(
        f"/api/v1/families/{family_a}/members",
        json={"name": "Intruder", "color": "#ff0000"},
        headers=auth_headers,
    )
    assert created.status_code == 403

    # The stranger has no families of their own.
    mine = await client.get("/api/v1/me/memberships", headers=auth_headers)
    assert mine.status_code == 200
    assert mine.json() == []


async def test_viewer_role_cannot_create_members(
    client, auth_headers, session: AsyncSession, test_user: User
):
    family_b = await _create_family(client, auth_headers, "Family B")

    # A genuine member of Family B, but only a viewer.
    viewer = await _make_user(session, "user_viewer", "viewer@example.com")
    session.add(
        Membership(
            user_id=viewer.id,
            family_id=uuid.UUID(family_b),
            role=MembershipRole.viewer,
        )
    )
    await session.commit()

    _auth_as(viewer.clerk_user_id)

    # A viewer may read the roster (AnyFamilyMember)…
    listed = await client.get(f"/api/v1/families/{family_b}/members", headers=auth_headers)
    assert listed.status_code == 200

    # …but not create a member (FamilyOwnerOrAdult) → rejected on role, not membership.
    created = await client.post(
        f"/api/v1/families/{family_b}/members",
        json={"name": "Nope", "color": "#123456"},
        headers=auth_headers,
    )
    assert created.status_code == 403
    assert created.json()["detail"] == "Insufficient role"
