"""Chore balancer — auto day / who-starts planning.

Service-level tests exercise the optimizer end to end (spread across days, evening
a lopsided load, fixed/keep/lock modes) and assert the crucial property that
*applying* a plan reproduces exactly the per-person load the preview promised
(the engine resolves assignees the same way the optimizer simulated them). One
API test covers routing + auth + the apply round-trip.
"""

import uuid
from datetime import date, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.family import Family, Member
from app.models.task import AssignmentStrategy
from app.models.user import User
from app.schemas.task import BalanceItemIn, BalancePlanRequest, TaskCreate
from app.services import tasks as svc

# A Monday, so weekly placements are easy to reason about.
TODAY = date(2026, 7, 6)


async def _family_two(session: AsyncSession):
    family = Family(name="Bal Fam")
    session.add(family)
    await session.flush()
    alex = Member(family_id=family.id, name="Alex", color="#ff0000")
    sam = Member(family_id=family.id, name="Sam", color="#00ff00")
    session.add_all([alex, sam])
    await session.flush()
    return family, alex, sam


async def _weekly(session, family, title, member, rrule="FREQ=WEEKLY"):
    return await svc.create_task(
        family.id,
        TaskCreate(title=title, start_date=TODAY, rrule=rrule, member_ids=[member.id]),
        session,
    )


# ── core behaviour ──────────────────────────────────────────────────────────

async def test_spreads_two_weekly_chores_across_days_and_people(session: AsyncSession):
    family, alex, sam = await _family_two(session)
    t1 = await _weekly(session, family, "Vacuum", alex)
    t2 = await _weekly(session, family, "Bathroom", alex)

    req = BalancePlanRequest(
        member_ids=[alex.id, sam.id],
        items=[
            BalanceItemIn(task_id=t1.id, mode="rotate", minutes=30),
            BalanceItemIn(task_id=t2.id, mode="rotate", minutes=30),
        ],
    )
    plan = await svc.compute_balance_plan(family.id, req, session, today=TODAY)

    assert len(plan.changes) == 2
    # Placed on different weekdays (spread) and each starts with a different person.
    assert len({c.weekday for c in plan.changes}) == 2
    assert {c.starter_id for c in plan.changes} == {alex.id, sam.id}
    assert plan.preview.imbalance_after <= plan.preview.imbalance_before


async def test_evens_a_lopsided_load(session: AsyncSession):
    family, alex, sam = await _family_two(session)
    for i in range(4):
        await _weekly(session, family, f"Chore {i}", alex)  # all currently fall to Alex

    items = [
        BalanceItemIn(task_id=t.id, mode="rotate", minutes=30)
        for t in await svc.list_tasks(family.id, session)
    ]
    req = BalancePlanRequest(member_ids=[alex.id, sam.id], items=items)
    plan = await svc.compute_balance_plan(family.id, req, session, today=TODAY)

    afters = [p.after_per_week for p in plan.preview.people]
    assert plan.preview.imbalance_before > plan.preview.imbalance_after
    assert abs(afters[0] - afters[1]) <= 1.0  # within one chore of even


async def test_fixed_mode_assigns_to_named_member(session: AsyncSession):
    family, alex, sam = await _family_two(session)
    task = await svc.create_task(
        family.id,
        TaskCreate(
            title="Trash",
            start_date=TODAY,
            rrule="FREQ=WEEKLY",
            assignment_strategy=AssignmentStrategy.rotating,
            member_ids=[alex.id, sam.id],
        ),
        session,
    )
    req = BalancePlanRequest(
        member_ids=[alex.id, sam.id],
        items=[BalanceItemIn(task_id=task.id, mode="fixed", fixed_member_id=sam.id, minutes=20)],
    )
    plan = await svc.compute_balance_plan(family.id, req, session, today=TODAY)

    change = plan.changes[0]
    assert change.assignment_strategy == AssignmentStrategy.fixed
    assert change.member_ids == [sam.id]
    assert change.starter_id == sam.id


async def test_lock_day_keeps_the_weekday(session: AsyncSession):
    family, alex, sam = await _family_two(session)
    task = await _weekly(session, family, "Water plants", alex, rrule="FREQ=WEEKLY;BYDAY=WE")
    req = BalancePlanRequest(
        member_ids=[alex.id, sam.id],
        items=[BalanceItemIn(task_id=task.id, mode="rotate", lock_day=True, minutes=20)],
    )
    plan = await svc.compute_balance_plan(family.id, req, session, today=TODAY)

    change = plan.changes[0]
    assert change.weekday == 2  # Wednesday, unchanged
    assert "BYDAY=WE" in (change.rrule or "")


async def test_keep_mode_emits_no_change_but_counts_as_background(session: AsyncSession):
    family, alex, sam = await _family_two(session)
    kept = await svc.create_task(
        family.id,
        TaskCreate(title="Dishes", start_date=TODAY, rrule="FREQ=DAILY", member_ids=[alex.id]),
        session,
    )
    rotated = await _weekly(session, family, "Mop", alex)

    req = BalancePlanRequest(
        member_ids=[alex.id, sam.id],
        items=[
            BalanceItemIn(task_id=kept.id, mode="keep", minutes=30),
            BalanceItemIn(task_id=rotated.id, mode="rotate", minutes=30),
        ],
    )
    plan = await svc.compute_balance_plan(family.id, req, session, today=TODAY)

    changed_ids = {c.task_id for c in plan.changes}
    assert kept.id not in changed_ids  # kept untouched
    assert rotated.id in changed_ids
    # The kept daily chore (always Alex) shows up in Alex's "before" load.
    alex_before = next(p.before_per_week for p in plan.preview.people if p.member_id == alex.id)
    assert alex_before > 0


async def test_apply_reproduces_the_previewed_load(session: AsyncSession):
    """The heart of it: after applying, the engine's assignees match the preview."""
    family, alex, sam = await _family_two(session)
    daily = await svc.create_task(
        family.id,
        TaskCreate(title="Dishes", start_date=TODAY, rrule="FREQ=DAILY", member_ids=[alex.id]),
        session,
    )
    weeklies = [await _weekly(session, family, f"W{i}", alex) for i in range(3)]
    all_tasks = [daily, *weeklies]

    req = BalancePlanRequest(
        member_ids=[alex.id, sam.id],
        items=[BalanceItemIn(task_id=t.id, mode="rotate", minutes=30) for t in all_tasks],
        horizon_days=28,
        seed=1,
    )
    plan = await svc.compute_balance_plan(family.id, req, session, today=TODAY)
    updated = await svc.apply_balance_plan(family.id, req, session, today=TODAY)
    assert updated == len(all_tasks)

    # Re-derive per-person weekly load from the actual occurrence view.
    horizon_end = TODAY + timedelta(days=27)
    occs = await svc.get_task_occurrences(family.id, TODAY, horizon_end, session)
    load = {alex.id: 0.0, sam.id: 0.0}
    for o in occs:
        if not o.members:
            continue
        for m in o.members:
            load[m.id] += 30.0 / len(o.members)
    from_occurrences = {str(mid): round(load[mid] / 4, 2) for mid in (alex.id, sam.id)}
    from_preview = {str(p.member_id): p.after_per_week for p in plan.preview.people}
    assert from_occurrences == from_preview

    # Apply also persists the time estimate back onto each task.
    reloaded = await svc.get_task(daily.id, family.id, session)
    assert reloaded.estimated_minutes == 30


async def test_apply_reanchors_start_to_today_and_clears_past(session: AsyncSession):
    """A chore with a historical start re-anchors to today-onward on apply, so its
    pre-today occurrences (the backlog) stop generating."""
    family, alex, sam = await _family_two(session)
    past = TODAY - timedelta(days=21)
    task = await svc.create_task(
        family.id,
        TaskCreate(title="Old chore", start_date=past, rrule="FREQ=WEEKLY", member_ids=[alex.id]),
        session,
    )
    # Sanity: as created, it has occurrences before today.
    assert _expand_pre_today(task, past)

    req = BalancePlanRequest(
        member_ids=[alex.id, sam.id],
        items=[BalanceItemIn(task_id=task.id, mode="rotate", minutes=20)],
    )
    plan = await svc.compute_balance_plan(family.id, req, session, today=TODAY)
    assert plan.changes[0].start_date >= TODAY  # soonest occurrence, today-onward

    await svc.apply_balance_plan(family.id, req, session, today=TODAY)
    reloaded = await svc.get_task(task.id, family.id, session)
    assert reloaded.start_date >= TODAY
    # No occurrences remain before today — the old/backlog chores have disappeared.
    assert _expand_pre_today(reloaded, past) == []


def _expand_pre_today(task, lower: date) -> list[date]:
    return svc._expand_rrule(task.rrule, task.start_date, lower, TODAY - timedelta(days=1))


# ── API ───────────────────────────────────────────────────────────────────

async def test_balance_endpoints_via_api(
    client, auth_headers, session: AsyncSession, test_user: User
):
    fam = (await client.post("/api/v1/families", json={"name": "Bal"}, headers=auth_headers)).json()
    family_id = fam["id"]
    members = (
        await client.get(f"/api/v1/families/{family_id}/members", headers=auth_headers)
    ).json()
    owner_id = members[0]["id"]

    second = Member(family_id=uuid.UUID(family_id), name="Sam", color="#00aa00")
    session.add(second)
    await session.commit()
    await session.refresh(second)

    task = (
        await client.post(
            f"/api/v1/families/{family_id}/tasks",
            json={
                "title": "Vacuum",
                "start_date": "2026-07-06",
                "rrule": "FREQ=WEEKLY",
                "member_ids": [owner_id],
            },
            headers=auth_headers,
        )
    ).json()

    body = {
        "member_ids": [owner_id, str(second.id)],
        "items": [{"task_id": task["id"], "mode": "rotate", "minutes": 45}],
    }
    resp = await client.post(
        f"/api/v1/families/{family_id}/tasks/balance-plan", json=body, headers=auth_headers
    )
    assert resp.status_code == 200, resp.text
    plan = resp.json()
    assert len(plan["changes"]) == 1
    assert plan["changes"][0]["task_id"] == task["id"]
    assert len(plan["preview"]["people"]) == 2

    applied = await client.post(
        f"/api/v1/families/{family_id}/tasks/balance-plan/apply", json=body, headers=auth_headers
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["updated"] == 1
