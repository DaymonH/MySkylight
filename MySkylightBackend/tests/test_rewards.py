"""Rewards / star economy (FEATURES F14 / Phase 5).

Service tests cover the earn→redeem→approve/reject star math (including the pending
reserve and undo). API tests cover the role rules: children may request a redemption
but not approve it; viewers can't manage the catalog.
"""

import uuid
from datetime import date

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

import app.deps as deps_module
from app.main import app
from app.models.family import Family, Member, Membership, MembershipRole
from app.models.reward import RedemptionStatus
from app.models.user import User
from app.schemas.reward import RewardCreate
from app.schemas.task import TaskCreate
from app.services import rewards as svc
from app.services import tasks as tasks_svc


# ── helpers ───────────────────────────────────────────────────────────────────

async def _family_with_member(session: AsyncSession, color: str = "#abcdef"):
    family = Family(name="Star Fam")
    session.add(family)
    await session.flush()
    member = Member(family_id=family.id, name="Kid", color=color)
    session.add(member)
    await session.flush()
    return family, member


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


async def _earn_stars(session: AsyncSession, family, member, value: int, day: int = 1) -> None:
    task = await tasks_svc.create_task(
        family.id,
        TaskCreate(
            title=f"Chore {day}",
            start_date=date(2026, 6, day),
            star_value=value,
            member_ids=[member.id],
        ),
        session,
    )
    task = await tasks_svc.get_task(task.id, family.id, session)
    await tasks_svc.complete_task(task, member.id, date(2026, 6, day), family.id, session)


def _bal(balances, member_id):
    return next(b for b in balances if b.member_id == member_id)


# ── star math ───────────────────────────────────────────────────────────────

async def test_earn_redeem_approve_balance_math(session: AsyncSession):
    family, member = await _family_with_member(session)
    await _earn_stars(session, family, member, 5)

    bal = _bal(await svc.compute_balances(family.id, session), member.id)
    assert (bal.earned, bal.spent, bal.pending, bal.available) == (5, 0, 0, 5)

    reward = await svc.create_reward(
        family.id, RewardCreate(name="Ice cream", star_cost=3), session
    )
    redemption = await svc.request_redemption(family.id, reward, member.id, session)
    assert redemption.status == RedemptionStatus.pending

    # Pending reserves the stars (available drops, not yet spent).
    bal = _bal(await svc.compute_balances(family.id, session), member.id)
    assert (bal.earned, bal.spent, bal.pending, bal.available) == (5, 0, 3, 2)

    redemption = await svc.get_redemption(redemption.id, family.id, session)
    await svc.decide_redemption(redemption, True, session)  # approve
    bal = _bal(await svc.compute_balances(family.id, session), member.id)
    assert (bal.earned, bal.spent, bal.pending, bal.available) == (5, 3, 0, 2)


async def test_redeem_requires_enough_stars(session: AsyncSession):
    family, member = await _family_with_member(session)
    await _earn_stars(session, family, member, 2)
    reward = await svc.create_reward(family.id, RewardCreate(name="Big toy", star_cost=10), session)
    try:
        await svc.request_redemption(family.id, reward, member.id, session)
        raise AssertionError("expected ValueError for insufficient stars")
    except ValueError:
        pass


async def test_reject_releases_reserved_stars(session: AsyncSession):
    family, member = await _family_with_member(session)
    await _earn_stars(session, family, member, 4)
    reward = await svc.create_reward(family.id, RewardCreate(name="Toy", star_cost=4), session)
    red = await svc.request_redemption(family.id, reward, member.id, session)

    # While pending, none available.
    assert _bal(await svc.compute_balances(family.id, session), member.id).available == 0

    red = await svc.get_redemption(red.id, family.id, session)
    await svc.decide_redemption(red, False, session)  # reject → release
    bal = _bal(await svc.compute_balances(family.id, session), member.id)
    assert (bal.spent, bal.pending, bal.available) == (0, 0, 4)


async def test_uncomplete_removes_earned_stars(session: AsyncSession):
    family, member = await _family_with_member(session)
    task = await tasks_svc.create_task(
        family.id,
        TaskCreate(title="X", start_date=date(2026, 6, 1), star_value=2, member_ids=[member.id]),
        session,
    )
    task = await tasks_svc.get_task(task.id, family.id, session)
    await tasks_svc.complete_task(task, member.id, date(2026, 6, 1), family.id, session)
    assert _bal(await svc.compute_balances(family.id, session), member.id).earned == 2

    task = await tasks_svc.get_task(task.id, family.id, session)
    await tasks_svc.uncomplete_task(task, member.id, date(2026, 6, 1), session)
    assert _bal(await svc.compute_balances(family.id, session), member.id).earned == 0


async def test_decide_twice_is_rejected(session: AsyncSession):
    family, member = await _family_with_member(session)
    await _earn_stars(session, family, member, 3)
    reward = await svc.create_reward(family.id, RewardCreate(name="Sticker", star_cost=1), session)
    red = await svc.request_redemption(family.id, reward, member.id, session)
    red = await svc.get_redemption(red.id, family.id, session)
    await svc.decide_redemption(red, True, session)
    red = await svc.get_redemption(red.id, family.id, session)
    try:
        await svc.decide_redemption(red, True, session)
        raise AssertionError("expected ValueError deciding an already-decided redemption")
    except ValueError:
        pass


# ── API: roles ────────────────────────────────────────────────────────────────

async def test_reward_roles_via_api(
    client, auth_headers, session: AsyncSession, test_user: User
):
    fam = (await client.post("/api/v1/families", json={"name": "Stars"}, headers=auth_headers)).json()
    family_id = fam["id"]
    member_id = (
        await client.get(f"/api/v1/families/{family_id}/members", headers=auth_headers)
    ).json()[0]["id"]

    reward = await client.post(
        f"/api/v1/families/{family_id}/rewards",
        json={"name": "Movie night", "star_cost": 1, "icon": "🎬"},
        headers=auth_headers,
    )
    assert reward.status_code == 201
    reward_id = reward.json()["id"]

    # Earn stars: owner persona completes a 5-star chore.
    task = (
        await client.post(
            f"/api/v1/families/{family_id}/tasks",
            json={"title": "Tidy", "start_date": "2026-06-01", "star_value": 5, "member_ids": [member_id]},
            headers=auth_headers,
        )
    ).json()
    done = await client.post(
        f"/api/v1/families/{family_id}/tasks/{task['id']}/complete",
        json={"member_id": member_id, "occurrence_date": "2026-06-01"},
        headers=auth_headers,
    )
    assert done.status_code == 201

    balances = (
        await client.get(f"/api/v1/families/{family_id}/star-balances", headers=auth_headers)
    ).json()
    assert next(b for b in balances if b["member_id"] == member_id)["available"] == 5

    # A child may request a redemption.
    child = await _make_user(session, "user_child_r", "child_r@example.com")
    session.add(
        Membership(user_id=child.id, family_id=uuid.UUID(family_id), role=MembershipRole.child)
    )
    await session.commit()
    _auth_as(child.clerk_user_id)
    red = await client.post(
        f"/api/v1/families/{family_id}/rewards/{reward_id}/redeem",
        json={"member_id": member_id},
        headers=auth_headers,
    )
    assert red.status_code == 201 and red.json()["status"] == "pending"
    redemption_id = red.json()["id"]

    # …but may NOT approve it.
    refused = await client.post(
        f"/api/v1/families/{family_id}/redemptions/{redemption_id}/approve", headers=auth_headers
    )
    assert refused.status_code == 403

    # The owner approves.
    _auth_as(test_user.clerk_user_id)
    ok = await client.post(
        f"/api/v1/families/{family_id}/redemptions/{redemption_id}/approve", headers=auth_headers
    )
    assert ok.status_code == 200 and ok.json()["status"] == "approved"

    # A viewer can't manage the catalog.
    viewer = await _make_user(session, "user_viewer_r", "viewer_r@example.com")
    session.add(
        Membership(user_id=viewer.id, family_id=uuid.UUID(family_id), role=MembershipRole.viewer)
    )
    await session.commit()
    _auth_as(viewer.clerk_user_id)
    nope = await client.post(
        f"/api/v1/families/{family_id}/rewards", json={"name": "No", "star_cost": 1}, headers=auth_headers
    )
    assert nope.status_code == 403
