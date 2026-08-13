"""Invite flow (Share Access, FEATURES F13) — create / list / revoke / accept.

The autouse `patch_clerk_verify` fixture authenticates every request as `test_user`.
To exercise a *second* user accepting an invite we temporarily override the
verify dependency to a different Clerk user id (see `_accept_as`).
"""

import uuid
from datetime import date

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import app.deps as deps_module
from app.main import app
from app.models.family import Invitation, InvitationStatus, Member, Membership
from app.models.task import Task, TaskAssignment
from app.models.user import User


async def _create_family(client, auth_headers, name: str = "The Hansens") -> str:
    resp = await client.post("/api/v1/families", json={"name": name}, headers=auth_headers)
    assert resp.status_code == 201
    return resp.json()["id"]


async def test_create_invitation_returns_token(client, auth_headers):
    family_id = await _create_family(client, auth_headers)

    resp = await client.post(
        f"/api/v1/families/{family_id}/invitations",
        json={"email": "invitee@example.com", "role": "adult"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["email"] == "invitee@example.com"
    assert body["role"] == "adult"
    assert body["status"] == "pending"
    assert body["token"]  # exposed so the inviter can build an accept link


async def test_duplicate_pending_invitation_is_rejected(client, auth_headers):
    family_id = await _create_family(client, auth_headers)
    payload = {"email": "dupe@example.com", "role": "adult"}

    first = await client.post(
        f"/api/v1/families/{family_id}/invitations", json=payload, headers=auth_headers
    )
    assert first.status_code == 201
    second = await client.post(
        f"/api/v1/families/{family_id}/invitations", json=payload, headers=auth_headers
    )
    assert second.status_code == 409


async def test_list_and_revoke_invitation(client, auth_headers):
    family_id = await _create_family(client, auth_headers)
    created = await client.post(
        f"/api/v1/families/{family_id}/invitations",
        json={"email": "pending@example.com", "role": "viewer"},
        headers=auth_headers,
    )
    invitation_id = created.json()["id"]

    listed = await client.get(f"/api/v1/families/{family_id}/invitations", headers=auth_headers)
    assert listed.status_code == 200
    assert [i["id"] for i in listed.json()] == [invitation_id]

    revoked = await client.delete(
        f"/api/v1/families/{family_id}/invitations/{invitation_id}", headers=auth_headers
    )
    assert revoked.status_code == 204

    after = await client.get(f"/api/v1/families/{family_id}/invitations", headers=auth_headers)
    assert after.json() == []  # revoked drops out of the pending list


def _accept_as(clerk_user_id: str):
    """Swap the auth dependency so the next request is the given Clerk user."""

    async def _verify(request: Request) -> str:  # request must be typed (see conftest note)
        return clerk_user_id

    app.dependency_overrides[deps_module.verify_clerk_token] = _verify


async def test_accept_invitation_adds_member_and_persona(
    client, auth_headers, session: AsyncSession, test_user: User
):
    # Owner (test_user) creates a family and invites someone as an adult.
    family_id = await _create_family(client, auth_headers, name="Shared House")
    invite = await client.post(
        f"/api/v1/families/{family_id}/invitations",
        json={"email": "invitee@example.com", "role": "adult"},
        headers=auth_headers,
    )
    token = invite.json()["token"]

    # A second, already-provisioned user signs in and accepts.
    invitee = User(
        clerk_user_id="user_invitee_456",
        email="invitee@example.com",
        first_name="Inv",
        last_name="Itee",
    )
    session.add(invitee)
    await session.commit()
    await session.refresh(invitee)

    _accept_as(invitee.clerk_user_id)
    resp = await client.post(
        "/api/v1/invitations/accept", json={"token": token}, headers=auth_headers
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["family_id"] == family_id
    assert data["role"] == "adult"
    assert data["already_member"] is False

    # Membership row was created for the invitee in this family…
    membership = (
        await session.execute(
            select(Membership).where(
                Membership.user_id == invitee.id,
                Membership.family_id == uuid.UUID(family_id),
            )
        )
    ).scalar_one()
    assert membership.role.value == "adult"

    # …and the invitation is now marked accepted.
    invitation = (
        await session.execute(select(Invitation).where(Invitation.token == token))
    ).scalar_one()
    assert invitation.status == InvitationStatus.accepted

    # The invitee now sees the family via /me/memberships.
    mine = await client.get("/api/v1/me/memberships", headers=auth_headers)
    assert family_id in [m["family_id"] for m in mine.json()]


async def _create_member(client, auth_headers, family_id: str, name: str) -> str:
    """Create a login-less profile (persona) and return its id."""
    resp = await client.post(
        f"/api/v1/families/{family_id}/members",
        json={"name": name},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    return resp.json()["id"]


async def test_create_invitation_linked_to_existing_profile(client, auth_headers):
    # Pre-create a profile (e.g. a spouse already assigned to chores) with no login,
    # then create an invite that will claim it on accept.
    family_id = await _create_family(client, auth_headers, name="Link Me")
    member_id = await _create_member(client, auth_headers, family_id, "Wife")

    resp = await client.post(
        f"/api/v1/families/{family_id}/invitations",
        json={"email": "wife@example.com", "role": "adult", "member_id": member_id},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["member_id"] == member_id


async def test_invite_link_rejects_profile_that_already_has_login(
    client, auth_headers, test_user: User
):
    family_id = await _create_family(client, auth_headers, name="Already Linked")
    # A profile tied to a login can't be claimed by someone else.
    linked = await client.post(
        f"/api/v1/families/{family_id}/members",
        json={"name": "Me", "user_id": str(test_user.id)},
        headers=auth_headers,
    )
    member_id = linked.json()["id"]

    resp = await client.post(
        f"/api/v1/families/{family_id}/invitations",
        json={"email": "x@example.com", "role": "adult", "member_id": member_id},
        headers=auth_headers,
    )
    assert resp.status_code == 409


async def test_invite_link_rejects_profile_from_another_family(client, auth_headers):
    family_a = await _create_family(client, auth_headers, name="Family A")
    family_b = await _create_family(client, auth_headers, name="Family B")
    foreign_member = await _create_member(client, auth_headers, family_b, "Outsider")

    resp = await client.post(
        f"/api/v1/families/{family_a}/invitations",
        json={"email": "x@example.com", "role": "adult", "member_id": foreign_member},
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_accept_claims_existing_profile_and_keeps_chores(
    client, auth_headers, session: AsyncSession
):
    # Owner pre-makes the wife's profile and assigns her a chore — BEFORE she has a login.
    family_id = await _create_family(client, auth_headers, name="Chore House")
    member_id = await _create_member(client, auth_headers, family_id, "Wife")

    task = Task(family_id=uuid.UUID(family_id), title="Dishes", start_date=date.today())
    session.add(task)
    await session.flush()
    session.add(TaskAssignment(task_id=task.id, member_id=uuid.UUID(member_id)))
    await session.commit()

    # Invite linked to that profile; a brand-new user accepts.
    invite = await client.post(
        f"/api/v1/families/{family_id}/invitations",
        json={"email": "wife@example.com", "role": "adult", "member_id": member_id},
        headers=auth_headers,
    )
    token = invite.json()["token"]

    wife = User(clerk_user_id="user_wife_999", email="wife@example.com", first_name="Wife")
    session.add(wife)
    await session.commit()
    await session.refresh(wife)

    _accept_as(wife.clerk_user_id)
    resp = await client.post(
        "/api/v1/invitations/accept", json={"token": token}, headers=auth_headers
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["claimed"] is True
    # No duplicate persona was created — she got the SAME member she was assigned to.
    assert data["member_id"] == member_id

    # The pre-made profile is now linked to her login…
    claimed = (
        await session.execute(select(Member).where(Member.id == uuid.UUID(member_id)))
    ).scalar_one()
    assert claimed.user_id == wife.id

    # …exactly one non-deleted persona belongs to her in this family (no duplicate)…
    persona_count = await session.scalar(
        select(func.count())
        .select_from(Member)
        .where(
            Member.family_id == uuid.UUID(family_id),
            Member.user_id == wife.id,
            Member.deleted_at.is_(None),
        )
    )
    assert persona_count == 1

    # …and her chore assignment is untouched (still points at the same member).
    assignment = (
        await session.execute(
            select(TaskAssignment).where(TaskAssignment.member_id == uuid.UUID(member_id))
        )
    ).scalar_one()
    assert assignment.member_id == uuid.UUID(member_id)


async def test_accept_invalid_token_is_404(client, auth_headers):
    resp = await client.post(
        "/api/v1/invitations/accept", json={"token": "does-not-exist"}, headers=auth_headers
    )
    assert resp.status_code == 404


async def test_owner_can_invite_owner(client, auth_headers):
    family_id = await _create_family(client, auth_headers, name="Owner Grants")
    resp = await client.post(
        f"/api/v1/families/{family_id}/invitations",
        json={"email": "coowner@example.com", "role": "owner"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["role"] == "owner"


async def test_adult_cannot_invite_owner(
    client, auth_headers, session: AsyncSession, test_user: User
):
    # Owner (test_user) invites an adult, who accepts and becomes an adult member.
    family_id = await _create_family(client, auth_headers, name="Role Clamp")
    invite = await client.post(
        f"/api/v1/families/{family_id}/invitations",
        json={"email": "adult@example.com", "role": "adult"},
        headers=auth_headers,
    )
    token = invite.json()["token"]

    adult = User(clerk_user_id="user_adult_777", email="adult@example.com")
    session.add(adult)
    await session.commit()
    await session.refresh(adult)

    _accept_as(adult.clerk_user_id)
    accepted = await client.post(
        "/api/v1/invitations/accept", json={"token": token}, headers=auth_headers
    )
    assert accepted.status_code == 200

    # As that adult: inviting an owner is a privilege escalation → forbidden…
    forbidden = await client.post(
        f"/api/v1/families/{family_id}/invitations",
        json={"email": "newowner@example.com", "role": "owner"},
        headers=auth_headers,
    )
    assert forbidden.status_code == 403

    # …but inviting another adult is fine.
    ok = await client.post(
        f"/api/v1/families/{family_id}/invitations",
        json={"email": "newadult@example.com", "role": "adult"},
        headers=auth_headers,
    )
    assert ok.status_code == 201
