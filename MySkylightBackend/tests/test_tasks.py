"""Tasks & routines (FEATURES F01 / Phase 3).

Service-level tests cover the date-based recurrence engine, per-date completion
(daily reset), and streak maths. API-level tests cover routine/task CRUD, the
role rules (children may check off, viewers may not), and the complete/undo cycle.
"""

import uuid
from datetime import date, timedelta

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

import app.deps as deps_module
from app.main import app
from app.models.base import utcnow
from app.models.family import Family, Member, Membership, MembershipRole
from app.models.task import AssignmentStrategy, RotationUnit
from app.models.user import User
from app.schemas.task import TaskCreate
from app.services import tasks as svc


# ── helpers ───────────────────────────────────────────────────────────────────

async def _family_with_member(session: AsyncSession, color: str = "#abcdef"):
    family = Family(name="Task Fam")
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


# ── recurrence expansion ──────────────────────────────────────────────────────

async def test_daily_and_oneoff_expansion(session: AsyncSession):
    family, member = await _family_with_member(session)

    daily = await svc.create_task(
        family.id,
        TaskCreate(
            title="Brush teeth",
            start_date=date(2026, 6, 1),
            rrule="FREQ=DAILY;COUNT=5",
            member_ids=[member.id],
        ),
        session,
    )
    await svc.create_task(
        family.id,
        TaskCreate(title="Dentist", start_date=date(2026, 6, 3)),
        session,
    )

    occs = await svc.get_task_occurrences(family.id, date(2026, 6, 1), date(2026, 6, 30), session)
    daily_dates = sorted(o.occurrence_date for o in occs if o.task_id == daily.id)
    assert daily_dates == [date(2026, 6, d) for d in range(1, 6)]

    oneoff = [o for o in occs if o.title == "Dentist"]
    assert len(oneoff) == 1 and oneoff[0].occurrence_date == date(2026, 6, 3)
    # No override/member colour on the one-off → default task colour.
    assert oneoff[0].effective_color == svc.DEFAULT_TASK_COLOR
    # Recurring task inherits its assigned member's colour.
    assert next(o for o in occs if o.task_id == daily.id).effective_color == "#abcdef"


async def test_weekly_expansion_spacing(session: AsyncSession):
    family, _ = await _family_with_member(session)
    await svc.create_task(
        family.id,
        TaskCreate(title="Trash", start_date=date(2026, 6, 1), rrule="FREQ=WEEKLY;COUNT=3"),
        session,
    )
    occs = await svc.get_task_occurrences(family.id, date(2026, 6, 1), date(2026, 7, 31), session)
    assert sorted(o.occurrence_date for o in occs) == [
        date(2026, 6, 1),
        date(2026, 6, 8),
        date(2026, 6, 15),
    ]


# ── completion / daily reset ──────────────────────────────────────────────────

async def test_completion_is_per_date_and_idempotent(session: AsyncSession):
    family, member = await _family_with_member(session)
    task = await svc.create_task(
        family.id,
        TaskCreate(
            title="Make bed",
            start_date=date(2026, 6, 1),
            rrule="FREQ=DAILY;COUNT=3",
            member_ids=[member.id],
        ),
        session,
    )

    # Complete June 1 twice — second call is a no-op (no duplicate row / no error).
    await svc.complete_task(task, member.id, date(2026, 6, 1), family.id, session)
    task = await svc.get_task(task.id, family.id, session)
    await svc.complete_task(task, member.id, date(2026, 6, 1), family.id, session)
    task = await svc.get_task(task.id, family.id, session)
    assert len(task.completions) == 1

    occs = await svc.get_task_occurrences(family.id, date(2026, 6, 1), date(2026, 6, 3), session)
    by_date = {o.occurrence_date: o for o in occs}
    assert by_date[date(2026, 6, 1)].completed_member_ids == [member.id]
    # The next day resets — no completion carries over.
    assert by_date[date(2026, 6, 2)].completed_member_ids == []

    # Undo clears it.
    await svc.uncomplete_task(task, member.id, date(2026, 6, 1), session)
    task = await svc.get_task(task.id, family.id, session)
    assert task.completions == []


async def test_complete_rejects_foreign_member(session: AsyncSession):
    family, _ = await _family_with_member(session)
    other_family, other_member = await _family_with_member(session)
    task = await svc.create_task(
        family.id, TaskCreate(title="Chore", start_date=date(2026, 6, 1)), session
    )
    try:
        await svc.complete_task(task, other_member.id, date(2026, 6, 1), family.id, session)
        raise AssertionError("expected ValueError for a member of another family")
    except ValueError:
        pass


# ── streaks ───────────────────────────────────────────────────────────────────

async def test_streak_counts_run_and_today_pending_slides(session: AsyncSession):
    family, member = await _family_with_member(session)
    task = await svc.create_task(
        family.id,
        TaskCreate(
            title="Read",
            start_date=date(2026, 6, 1),
            rrule="FREQ=DAILY;COUNT=10",
            member_ids=[member.id],
        ),
        session,
    )
    for d in (1, 2, 3):
        task = await svc.get_task(task.id, family.id, session)
        await svc.complete_task(task, member.id, date(2026, 6, d), family.id, session)

    task = await svc.get_task(task.id, family.id, session)
    # June 4 is due but still pending — it shouldn't break the 3-day run.
    current, longest = svc.compute_streak(task, member.id, date(2026, 6, 4))
    assert (current, longest) == (3, 3)


async def test_streak_breaks_on_a_past_miss(session: AsyncSession):
    family, member = await _family_with_member(session)
    task = await svc.create_task(
        family.id,
        TaskCreate(
            title="Vitamins",
            start_date=date(2026, 6, 1),
            rrule="FREQ=DAILY;COUNT=10",
            member_ids=[member.id],
        ),
        session,
    )
    for d in (1, 2):  # skip June 3
        task = await svc.get_task(task.id, family.id, session)
        await svc.complete_task(task, member.id, date(2026, 6, d), family.id, session)

    task = await svc.get_task(task.id, family.id, session)
    # As of June 5: June 5 pending slides, June 4 missed → current run is 0; longest still 2.
    current, longest = svc.compute_streak(task, member.id, date(2026, 6, 5))
    assert (current, longest) == (0, 2)


# ── API: CRUD ─────────────────────────────────────────────────────────────────

async def test_routine_and_task_crud_via_api(client, auth_headers):
    fam = (await client.post("/api/v1/families", json={"name": "Hansens"}, headers=auth_headers)).json()
    family_id = fam["id"]
    members = (await client.get(f"/api/v1/families/{family_id}/members", headers=auth_headers)).json()
    member_id = members[0]["id"]

    # Routine
    routine = await client.post(
        f"/api/v1/families/{family_id}/routines",
        json={"name": "Morning", "sort_order": 0},
        headers=auth_headers,
    )
    assert routine.status_code == 201
    routine_id = routine.json()["id"]

    # Task inside the routine, assigned to the owner persona
    created = await client.post(
        f"/api/v1/families/{family_id}/tasks",
        json={
            "routine_id": routine_id,
            "title": "Get dressed",
            "start_date": "2026-06-01",
            "rrule": "FREQ=DAILY;COUNT=3",
            "member_ids": [member_id],
        },
        headers=auth_headers,
    )
    assert created.status_code == 201
    task_id = created.json()["id"]
    assert created.json()["members"][0]["id"] == member_id

    # The routine now nests the task.
    routines = (await client.get(f"/api/v1/families/{family_id}/routines", headers=auth_headers)).json()
    assert routines[0]["tasks"][0]["id"] == task_id

    # Occurrences expand within range.
    occs = await client.get(
        f"/api/v1/families/{family_id}/tasks/occurrences",
        params={"from": "2026-06-01", "to": "2026-06-30"},
        headers=auth_headers,
    )
    assert occs.status_code == 200
    assert len(occs.json()) == 3

    # Patch + delete.
    patched = await client.patch(
        f"/api/v1/families/{family_id}/tasks/{task_id}",
        json={"title": "Put on uniform"},
        headers=auth_headers,
    )
    assert patched.status_code == 200 and patched.json()["title"] == "Put on uniform"

    deleted = await client.delete(
        f"/api/v1/families/{family_id}/tasks/{task_id}", headers=auth_headers
    )
    assert deleted.status_code == 204
    after = (await client.get(f"/api/v1/families/{family_id}/tasks", headers=auth_headers)).json()
    assert after == []


# ── API: roles + completion ───────────────────────────────────────────────────

async def test_child_can_complete_but_viewer_cannot_create(
    client, auth_headers, session: AsyncSession, test_user: User
):
    fam = (await client.post("/api/v1/families", json={"name": "Roles"}, headers=auth_headers)).json()
    family_id = fam["id"]
    member_id = (
        await client.get(f"/api/v1/families/{family_id}/members", headers=auth_headers)
    ).json()[0]["id"]

    # Owner creates a task.
    task_id = (
        await client.post(
            f"/api/v1/families/{family_id}/tasks",
            json={"title": "Feed dog", "start_date": "2026-06-01", "rrule": "FREQ=DAILY"},
            headers=auth_headers,
        )
    ).json()["id"]

    # A child member of this family.
    child = await _make_user(session, "user_child", "child@example.com")
    session.add(
        Membership(user_id=child.id, family_id=uuid.UUID(family_id), role=MembershipRole.child)
    )
    await session.commit()

    _auth_as(child.clerk_user_id)
    done = await client.post(
        f"/api/v1/families/{family_id}/tasks/{task_id}/complete",
        json={"member_id": member_id, "occurrence_date": "2026-06-01"},
        headers=auth_headers,
    )
    assert done.status_code == 201

    # The occurrence now reports the completion.
    occs = (
        await client.get(
            f"/api/v1/families/{family_id}/tasks/occurrences",
            params={"from": "2026-06-01", "to": "2026-06-01"},
            headers=auth_headers,
        )
    ).json()
    assert occs[0]["completed_member_ids"] == [member_id]

    # A viewer of the family may not create tasks.
    viewer = await _make_user(session, "user_viewer_t", "viewer_t@example.com")
    session.add(
        Membership(user_id=viewer.id, family_id=uuid.UUID(family_id), role=MembershipRole.viewer)
    )
    await session.commit()

    _auth_as(viewer.clerk_user_id)
    refused = await client.post(
        f"/api/v1/families/{family_id}/tasks",
        json={"title": "Nope", "start_date": "2026-06-01"},
        headers=auth_headers,
    )
    assert refused.status_code == 403
    assert refused.json()["detail"] == "Insufficient role"


# ── Rotating assignment (F27) ───────────────────────────────────────────────────

async def _three_member_family(session: AsyncSession):
    family = Family(name="Rotate Fam")
    session.add(family)
    await session.flush()
    members = []
    for name, color in (("Alex", "#111111"), ("Sam", "#222222"), ("Jo", "#333333")):
        m = Member(family_id=family.id, name=name, color=color)
        session.add(m)
        members.append(m)
    await session.flush()
    return family, members


async def test_rotating_assignment_cycles_across_occurrences(session: AsyncSession):
    family, (alex, sam, jo) = await _three_member_family(session)
    await svc.create_task(
        family.id,
        TaskCreate(
            title="Dishes",
            start_date=date(2026, 6, 1),
            rrule="FREQ=DAILY;COUNT=7",
            assignment_strategy=AssignmentStrategy.rotating,
            member_ids=[alex.id, sam.id, jo.id],
        ),
        session,
    )
    occs = await svc.get_task_occurrences(family.id, date(2026, 6, 1), date(2026, 6, 7), session)
    by_date = {o.occurrence_date: o for o in occs}

    # Exactly one assignee per occurrence, cycling Alex→Sam→Jo→Alex…
    expected = [alex.id, sam.id, jo.id, alex.id, sam.id, jo.id, alex.id]
    got = [by_date[date(2026, 6, d)].members[0].id for d in range(1, 8)]
    assert got == expected
    assert all(len(by_date[date(2026, 6, d)].members) == 1 for d in range(1, 8))

    # Colour follows the rotated assignee; up_next points to tomorrow's person.
    assert by_date[date(2026, 6, 1)].effective_color == "#111111"
    assert by_date[date(2026, 6, 2)].effective_color == "#222222"
    assert by_date[date(2026, 6, 1)].up_next is not None
    assert by_date[date(2026, 6, 1)].up_next.id == sam.id


async def test_rotating_window_uses_absolute_index(session: AsyncSession):
    # A window that doesn't start at the series start still resolves the right person.
    family, (alex, sam, jo) = await _three_member_family(session)
    await svc.create_task(
        family.id,
        TaskCreate(
            title="Trash",
            start_date=date(2026, 6, 1),
            rrule="FREQ=DAILY;COUNT=10",
            assignment_strategy=AssignmentStrategy.rotating,
            member_ids=[alex.id, sam.id, jo.id],
        ),
        session,
    )
    # Query only June 4 (index 3 → Alex again).
    occs = await svc.get_task_occurrences(family.id, date(2026, 6, 4), date(2026, 6, 4), session)
    assert len(occs) == 1
    assert occs[0].members[0].id == alex.id


async def test_rotating_skips_soft_deleted_member(session: AsyncSession):
    family, (alex, sam, jo) = await _three_member_family(session)
    await svc.create_task(
        family.id,
        TaskCreate(
            title="Dishes",
            start_date=date(2026, 6, 1),
            rrule="FREQ=DAILY;COUNT=6",
            assignment_strategy=AssignmentStrategy.rotating,
            member_ids=[alex.id, sam.id, jo.id],
        ),
        session,
    )
    # Remove Sam → roster shrinks to [Alex, Jo]; cycle continues, no crash.
    sam.deleted_at = utcnow()
    await session.commit()

    occs = await svc.get_task_occurrences(family.id, date(2026, 6, 1), date(2026, 6, 6), session)
    by_date = {o.occurrence_date: o for o in occs}
    got = [by_date[date(2026, 6, d)].members[0].id for d in range(1, 7)]
    assert got == [alex.id, jo.id, alex.id, jo.id, alex.id, jo.id]
    assert all(o.members[0].id != sam.id for o in occs)


async def test_fixed_assignment_shows_all_members(session: AsyncSession):
    # Default (fixed) is unchanged: every assignee appears on each occurrence.
    family, (alex, sam, jo) = await _three_member_family(session)
    await svc.create_task(
        family.id,
        TaskCreate(
            title="Tidy up",
            start_date=date(2026, 6, 1),
            rrule="FREQ=DAILY;COUNT=2",
            member_ids=[alex.id, sam.id, jo.id],  # assignment_strategy defaults to fixed
        ),
        session,
    )
    occs = await svc.get_task_occurrences(family.id, date(2026, 6, 1), date(2026, 6, 2), session)
    assert occs[0].up_next is None
    assert {m.id for m in occs[0].members} == {alex.id, sam.id, jo.id}


# ── Decoupled rotation cadence (F27) ────────────────────────────────────────────
# 2026-06-01 is a Monday, so weekly buckets align to it cleanly.

async def test_rotation_defaults_to_per_occurrence(session: AsyncSession):
    # Omitting the cadence fields reproduces the original per-occurrence rotation.
    family, (alex, sam, _jo) = await _three_member_family(session)
    task = await svc.create_task(
        family.id,
        TaskCreate(
            title="Dishes",
            start_date=date(2026, 6, 1),
            rrule="FREQ=DAILY;COUNT=3",
            assignment_strategy=AssignmentStrategy.rotating,
            member_ids=[alex.id, sam.id],
        ),
        session,
    )
    assert task.rotation_unit == RotationUnit.occurrence
    assert task.rotation_interval == 1
    assert task.rotation_anchor_date is None


async def test_daily_chore_with_weekly_owner(session: AsyncSession):
    # The motivating case: chore happens every day, but one person owns the whole
    # calendar week (Mon–Sun) before it hands off.
    family, (alex, sam, _jo) = await _three_member_family(session)
    await svc.create_task(
        family.id,
        TaskCreate(
            title="Dishes",
            start_date=date(2026, 6, 1),  # Monday
            rrule="FREQ=DAILY;COUNT=21",
            assignment_strategy=AssignmentStrategy.rotating,
            rotation_unit=RotationUnit.week,
            rotation_interval=1,
            member_ids=[alex.id, sam.id],
        ),
        session,
    )
    occs = await svc.get_task_occurrences(family.id, date(2026, 6, 1), date(2026, 6, 21), session)
    by_date = {o.occurrence_date: o for o in occs}

    for d in range(1, 8):  # Mon Jun 1 – Sun Jun 7
        assert by_date[date(2026, 6, d)].members[0].id == alex.id
    for d in range(8, 15):  # Mon Jun 8 – Sun Jun 14 → hands off to Sam
        assert by_date[date(2026, 6, d)].members[0].id == sam.id
    assert by_date[date(2026, 6, 15)].members[0].id == alex.id  # back to Alex

    # "Up next" within Alex's week points at the next owner, not tomorrow.
    assert by_date[date(2026, 6, 1)].up_next.id == sam.id


async def test_rotate_every_n_days(session: AsyncSession):
    family, (alex, sam, jo) = await _three_member_family(session)
    await svc.create_task(
        family.id,
        TaskCreate(
            title="Trash",
            start_date=date(2026, 6, 1),
            rrule="FREQ=DAILY;COUNT=9",
            assignment_strategy=AssignmentStrategy.rotating,
            rotation_unit=RotationUnit.day,
            rotation_interval=3,
            member_ids=[alex.id, sam.id, jo.id],
        ),
        session,
    )
    occs = await svc.get_task_occurrences(family.id, date(2026, 6, 1), date(2026, 6, 9), session)
    by_date = {o.occurrence_date: o.members[0].id for o in occs}
    got = [by_date[date(2026, 6, d)] for d in range(1, 10)]
    assert got == [alex.id] * 3 + [sam.id] * 3 + [jo.id] * 3


async def test_rotate_monthly_over_a_weekly_chore(session: AsyncSession):
    family, (alex, sam, _jo) = await _three_member_family(session)
    await svc.create_task(
        family.id,
        TaskCreate(
            title="Mow",
            start_date=date(2026, 6, 6),  # first Saturday
            rrule="FREQ=WEEKLY;COUNT=12",
            assignment_strategy=AssignmentStrategy.rotating,
            rotation_unit=RotationUnit.month,
            rotation_interval=1,
            member_ids=[alex.id, sam.id],
        ),
        session,
    )
    occs = await svc.get_task_occurrences(family.id, date(2026, 6, 1), date(2026, 8, 31), session)
    by_month: dict[int, set] = {}
    for o in occs:
        by_month.setdefault(o.occurrence_date.month, set()).add(o.members[0].id)
    assert by_month[6] == {alex.id}  # June → Alex
    assert by_month[7] == {sam.id}  # July → Sam
    assert by_month[8] == {alex.id}  # August → back to Alex


async def test_rotate_every_two_occurrences(session: AsyncSession):
    family, (alex, sam, jo) = await _three_member_family(session)
    await svc.create_task(
        family.id,
        TaskCreate(
            title="Recycling",
            start_date=date(2026, 6, 1),
            rrule="FREQ=DAILY;COUNT=6",
            assignment_strategy=AssignmentStrategy.rotating,
            rotation_unit=RotationUnit.occurrence,
            rotation_interval=2,
            member_ids=[alex.id, sam.id, jo.id],
        ),
        session,
    )
    occs = await svc.get_task_occurrences(family.id, date(2026, 6, 1), date(2026, 6, 6), session)
    by_date = {o.occurrence_date: o.members[0].id for o in occs}
    got = [by_date[date(2026, 6, d)] for d in range(1, 7)]
    assert got == [alex.id, alex.id, sam.id, sam.id, jo.id, jo.id]


async def test_streak_counts_assigned_turns_for_rotating(session: AsyncSession):
    # A daily chore with weekly owners: Alex owns Jun 1–7 and Jun 15–21; Sam owns
    # Jun 8–14. Alex completing both of his weeks is an unbroken 14-turn streak —
    # Sam's week in between is not Alex's responsibility, so it doesn't reset it.
    family, (alex, sam, _jo) = await _three_member_family(session)
    task = await svc.create_task(
        family.id,
        TaskCreate(
            title="Dishes",
            start_date=date(2026, 6, 1),
            rrule="FREQ=DAILY;COUNT=30",
            assignment_strategy=AssignmentStrategy.rotating,
            rotation_unit=RotationUnit.week,
            rotation_interval=1,
            member_ids=[alex.id, sam.id],
        ),
        session,
    )
    for d in list(range(1, 8)) + list(range(15, 22)):  # Alex's two weeks
        task = await svc.get_task(task.id, family.id, session)
        await svc.complete_task(task, alex.id, date(2026, 6, d), family.id, session)

    task = await svc.get_task(task.id, family.id, session)
    current, longest = svc.compute_streak(task, alex.id, date(2026, 6, 21))
    assert (current, longest) == (14, 14)


# ── Rotation overrides: swap / skip (F27) ───────────────────────────────────────

async def _rotating_daily(session: AsyncSession, count: int, **kwargs):
    family, members = await _three_member_family(session)
    task = await svc.create_task(
        family.id,
        TaskCreate(
            title="Dishes",
            start_date=date(2026, 6, 1),
            rrule=f"FREQ=DAILY;COUNT={count}",
            assignment_strategy=AssignmentStrategy.rotating,
            member_ids=[m.id for m in members],
            **kwargs,
        ),
        session,
    )
    return family, members, await svc.get_task(task.id, family.id, session)


async def test_override_reassigns_a_single_occurrence(session: AsyncSession):
    family, (alex, sam, jo), task = await _rotating_daily(session, 4)
    # Default occurrence/1 → Jun1 Alex, Jun2 Sam, Jun3 Jo, Jun4 Alex.
    rows = await svc.set_rotation_override(task, date(2026, 6, 2), jo.id, "occurrence", family.id, session)
    assert len(rows) == 1 and rows[0].member_id == jo.id

    occs = await svc.get_task_occurrences(family.id, date(2026, 6, 1), date(2026, 6, 4), session)
    by_date = {o.occurrence_date: o for o in occs}
    assert by_date[date(2026, 6, 2)].members[0].id == jo.id  # Sam → Jo
    assert by_date[date(2026, 6, 2)].is_overridden is True
    assert by_date[date(2026, 6, 2)].is_skipped is False
    assert by_date[date(2026, 6, 1)].members[0].id == alex.id  # neighbours untouched
    assert by_date[date(2026, 6, 1)].is_overridden is False


async def test_override_skip_excuses_an_occurrence(session: AsyncSession):
    family, (alex, _sam, _jo), task = await _rotating_daily(session, 3)
    await svc.set_rotation_override(task, date(2026, 6, 1), None, "occurrence", family.id, session)

    occs = await svc.get_task_occurrences(family.id, date(2026, 6, 1), date(2026, 6, 3), session)
    j1 = next(o for o in occs if o.occurrence_date == date(2026, 6, 1))
    assert j1.members == [] and j1.is_skipped is True and j1.is_overridden is True


async def test_override_turn_skips_the_whole_week(session: AsyncSession):
    family, (alex, sam, _jo), task = await _rotating_daily(
        session, 21, rotation_unit=RotationUnit.week, rotation_interval=1
    )
    # Alex owns Jun 1–7, Sam owns Jun 8–14. Skip Alex's whole week via any day in it.
    rows = await svc.set_rotation_override(task, date(2026, 6, 3), None, "turn", family.id, session)
    assert {r.occurrence_date for r in rows} == {date(2026, 6, d) for d in range(1, 8)}

    occs = await svc.get_task_occurrences(family.id, date(2026, 6, 1), date(2026, 6, 14), session)
    by_date = {o.occurrence_date: o for o in occs}
    for d in range(1, 8):
        assert by_date[date(2026, 6, d)].is_skipped is True
        assert by_date[date(2026, 6, d)].members == []
    for d in range(8, 15):  # Sam's week is untouched
        assert by_date[date(2026, 6, d)].members[0].id == sam.id
        assert by_date[date(2026, 6, d)].is_skipped is False


async def test_clear_override_reverts_to_computed(session: AsyncSession):
    family, (alex, sam, _jo), task = await _rotating_daily(session, 3)
    await svc.set_rotation_override(task, date(2026, 6, 1), sam.id, "occurrence", family.id, session)
    task = await svc.get_task(task.id, family.id, session)
    await svc.clear_rotation_override(task, date(2026, 6, 1), "occurrence", session)

    occs = await svc.get_task_occurrences(family.id, date(2026, 6, 1), date(2026, 6, 1), session)
    assert occs[0].members[0].id == alex.id  # back to the computed assignee
    assert occs[0].is_overridden is False


async def test_streak_honors_a_swapped_away_turn(session: AsyncSession):
    family, (alex, sam, _jo), task = await _rotating_daily(
        session, 14, rotation_unit=RotationUnit.week, rotation_interval=1
    )
    # Alex owns Jun 1–7; swap Jun 3 to Sam → Alex's turns are Jun 1,2,4,5,6,7.
    await svc.set_rotation_override(task, date(2026, 6, 3), sam.id, "occurrence", family.id, session)
    for d in (1, 2, 4, 5, 6, 7):
        task = await svc.get_task(task.id, family.id, session)
        await svc.complete_task(task, alex.id, date(2026, 6, d), family.id, session)

    task = await svc.get_task(task.id, family.id, session)
    current, longest = svc.compute_streak(task, alex.id, date(2026, 6, 7))
    assert (current, longest) == (6, 6)  # the swapped-away Jun 3 isn't a gap for Alex


async def test_override_rejects_foreign_member_and_fixed_task(session: AsyncSession):
    family, (alex, sam, _jo), rotating = await _rotating_daily(session, 3)
    _other_family, other_member = await _family_with_member(session)
    try:
        await svc.set_rotation_override(
            rotating, date(2026, 6, 1), other_member.id, "occurrence", family.id, session
        )
        raise AssertionError("expected ValueError for a member of another family")
    except ValueError:
        pass

    fixed = await svc.create_task(
        family.id,
        TaskCreate(title="Tidy", start_date=date(2026, 6, 1), rrule="FREQ=DAILY", member_ids=[alex.id]),
        session,
    )
    fixed = await svc.get_task(fixed.id, family.id, session)
    try:
        await svc.set_rotation_override(fixed, date(2026, 6, 1), alex.id, "occurrence", family.id, session)
        raise AssertionError("expected ValueError for a non-rotating task")
    except ValueError:
        pass


async def test_override_api_set_list_clear_and_roles(
    client, auth_headers, session: AsyncSession, test_user: User
):
    fam = (await client.post("/api/v1/families", json={"name": "Overrides"}, headers=auth_headers)).json()
    family_id = fam["id"]
    owner_member_id = (
        await client.get(f"/api/v1/families/{family_id}/members", headers=auth_headers)
    ).json()[0]["id"]

    # A second persona so the chore can rotate.
    bee = Member(family_id=uuid.UUID(family_id), name="Bee", color="#abcdef")
    session.add(bee)
    await session.commit()
    await session.refresh(bee)

    task_id = (
        await client.post(
            f"/api/v1/families/{family_id}/tasks",
            json={
                "title": "Dishes",
                "start_date": "2026-06-01",
                "rrule": "FREQ=DAILY;COUNT=5",
                "assignment_strategy": "rotating",
                "member_ids": [owner_member_id, str(bee.id)],
            },
            headers=auth_headers,
        )
    ).json()["id"]

    # Owner skips Jun 1.
    put = await client.put(
        f"/api/v1/families/{family_id}/tasks/{task_id}/overrides/2026-06-01",
        json={"member_id": None, "scope": "occurrence"},
        headers=auth_headers,
    )
    assert put.status_code == 200

    listed = (
        await client.get(
            f"/api/v1/families/{family_id}/tasks/{task_id}/overrides", headers=auth_headers
        )
    ).json()
    assert len(listed) == 1 and listed[0]["member_id"] is None

    occ = (
        await client.get(
            f"/api/v1/families/{family_id}/tasks/occurrences",
            params={"from": "2026-06-01", "to": "2026-06-01"},
            headers=auth_headers,
        )
    ).json()
    assert occ[0]["is_skipped"] is True and occ[0]["members"] == []

    # Owner clears it → Jun 1 reverts to the first roster member (the owner).
    cleared = await client.delete(
        f"/api/v1/families/{family_id}/tasks/{task_id}/overrides/2026-06-01", headers=auth_headers
    )
    assert cleared.status_code == 204
    occ = (
        await client.get(
            f"/api/v1/families/{family_id}/tasks/occurrences",
            params={"from": "2026-06-01", "to": "2026-06-01"},
            headers=auth_headers,
        )
    ).json()
    assert occ[0]["members"][0]["id"] == owner_member_id and occ[0]["is_skipped"] is False

    # A child may check chores off but may not reassign them.
    child = await _make_user(session, "user_ovr_child", "ovrchild@example.com")
    session.add(
        Membership(user_id=child.id, family_id=uuid.UUID(family_id), role=MembershipRole.child)
    )
    await session.commit()
    _auth_as(child.clerk_user_id)
    refused = await client.put(
        f"/api/v1/families/{family_id}/tasks/{task_id}/overrides/2026-06-02",
        json={"member_id": None},
        headers=auth_headers,
    )
    assert refused.status_code == 403


# ── Move to today (re-phase a recurring chore's cadence, F01) ────────────────────

async def test_move_to_today_rephases_every_other_day(session: AsyncSession):
    # Every-other-day chore anchored so *yesterday* (06-09) was an occurrence and the
    # next would be *tomorrow* (06-11). Doing it today should re-phase to today+2.
    family, member = await _family_with_member(session)
    task = await svc.create_task(
        family.id,
        TaskCreate(
            title="Water plants",
            start_date=date(2026, 6, 1),  # 06-01,03,05,07,09,11,… (09 = yesterday of 06-10)
            rrule="FREQ=DAILY;INTERVAL=2",
            member_ids=[member.id],
        ),
        session,
    )

    task, completed = await svc.move_task_to_today(
        task, member.id, family.id, session, today=date(2026, 6, 10)
    )
    assert completed is True
    assert task.start_date == date(2026, 6, 10)

    occs = await svc.get_task_occurrences(family.id, date(2026, 6, 10), date(2026, 6, 20), session)
    dates = sorted(o.occurrence_date for o in occs if o.task_id == task.id)
    # Today, then +2 (12th) — NOT tomorrow (11th).
    assert dates[:3] == [date(2026, 6, 10), date(2026, 6, 12), date(2026, 6, 14)]
    # Today's occurrence is checked off for the member who did it.
    today_occ = next(o for o in occs if o.occurrence_date == date(2026, 6, 10))
    assert member.id in today_occ.completed_member_ids


async def test_move_to_today_preserves_week_rotation_anchor(session: AsyncSession):
    # A daily chore with a *weekly* owner should keep whose turn it is: moving the
    # start freezes the rotation anchor at the old start so the assignee is invariant.
    family, (alex, sam, _jo) = await _three_member_family(session)
    task = await svc.create_task(
        family.id,
        TaskCreate(
            title="Dishes",
            start_date=date(2026, 6, 1),  # Monday
            rrule="FREQ=DAILY",
            assignment_strategy=AssignmentStrategy.rotating,
            rotation_unit=RotationUnit.week,
            rotation_interval=1,
            member_ids=[alex.id, sam.id],
        ),
        session,
    )
    before = await svc.get_task_occurrences(family.id, date(2026, 6, 20), date(2026, 6, 20), session)
    who_before = before[0].members[0].id

    task, _ = await svc.move_task_to_today(
        task, None, family.id, session, today=date(2026, 6, 15)
    )
    # Anchor pinned to the old start so week buckets don't shift.
    assert task.rotation_anchor_date == date(2026, 6, 1)
    assert task.start_date == date(2026, 6, 15)

    after = await svc.get_task_occurrences(family.id, date(2026, 6, 20), date(2026, 6, 20), session)
    assert after[0].members[0].id == who_before


async def test_move_to_today_rejects_oneoff_byday_and_expired(session: AsyncSession):
    family, member = await _family_with_member(session)

    # (a) One-off (no rrule) — nothing to re-phase.
    oneoff = await svc.create_task(
        family.id, TaskCreate(title="Dentist", start_date=date(2026, 6, 1)), session
    )
    try:
        await svc.move_task_to_today(oneoff, None, family.id, session, today=date(2026, 6, 10))
        raise AssertionError("expected ValueError for a one-off task")
    except ValueError:
        pass

    # (b) BYDAY-pinned — re-anchoring can't move a hardcoded weekday set.
    byday = await svc.create_task(
        family.id,
        TaskCreate(
            title="Weekday tidy",
            start_date=date(2026, 6, 1),
            rrule="FREQ=WEEKLY;BYDAY=MO,WE,FR",
            member_ids=[member.id],
        ),
        session,
    )
    try:
        await svc.move_task_to_today(byday, None, family.id, session, today=date(2026, 6, 10))
        raise AssertionError("expected ValueError for a BYDAY-pinned task")
    except ValueError:
        pass

    # (c) Repeat already ended (UNTIL in the past) — moving to today would empty it.
    expired = await svc.create_task(
        family.id,
        TaskCreate(
            title="Old chore",
            start_date=date(2026, 6, 1),
            rrule="FREQ=DAILY;UNTIL=20260605",
            member_ids=[member.id],
        ),
        session,
    )
    try:
        await svc.move_task_to_today(expired, None, family.id, session, today=date(2026, 6, 10))
        raise AssertionError("expected ValueError for an expired repeat")
    except ValueError:
        pass


async def test_move_to_today_via_api(client, auth_headers):
    fam = (await client.post("/api/v1/families", json={"name": "Move"}, headers=auth_headers)).json()
    family_id = fam["id"]
    member_id = (
        await client.get(f"/api/v1/families/{family_id}/members", headers=auth_headers)
    ).json()[0]["id"]
    start = (date.today() - timedelta(days=6)).isoformat()
    task_id = (
        await client.post(
            f"/api/v1/families/{family_id}/tasks",
            json={
                "title": "Vacuum",
                "start_date": start,
                "rrule": "FREQ=DAILY;INTERVAL=2",
                "member_ids": [member_id],
            },
            headers=auth_headers,
        )
    ).json()["id"]

    resp = await client.post(
        f"/api/v1/families/{family_id}/tasks/{task_id}/move-to-today",
        json={"member_id": member_id},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["start_date"] == date.today().isoformat()

    today = date.today().isoformat()
    occ = (
        await client.get(
            f"/api/v1/families/{family_id}/tasks/occurrences",
            params={"from": today, "to": today},
            headers=auth_headers,
        )
    ).json()
    mine = next(o for o in occ if o["task_id"] == task_id)
    assert member_id in mine["completed_member_ids"]
