import uuid
from datetime import date, datetime, time, timedelta

from dateutil.rrule import rrulestr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.base import utcnow
from app.models.family import Member
from app.models.task import (
    AssignmentStrategy,
    RotationUnit,
    Routine,
    Task,
    TaskAssignment,
    TaskCompletion,
    TaskRotationOverride,
)
from app.schemas.event import MemberBrief
from app.schemas.task import (
    BalanceChangeOut,
    BalancePersonOut,
    BalancePlanOut,
    BalancePlanRequest,
    BalancePreviewOut,
    RoutineCreate,
    RoutineUpdate,
    TaskCreate,
    TaskOccurrenceOut,
    TaskUpdate,
)
from app.services.chore_balancer import Loads, OptItem, optimize

DEFAULT_TASK_COLOR = "#6366f1"


# ── Color resolution (event override → member → default) ──────────────────────

def _resolve_task_color(task_color: str | None, member_colors: list[str]) -> str:
    if task_color:
        return task_color
    if member_colors:
        return member_colors[0]
    return DEFAULT_TASK_COLOR


# ── Occurrence dates (date-based recurrence) ──────────────────────────────────

def _expand_rrule(
    rrule: str | None, start_date: date, from_date: date, to_date: date
) -> list[date]:
    """Occurrence dates of a recurrence in [from_date, to_date], anchored at start_date.

    Standalone (no ORM) so the balancer can expand hypothetical placements; the
    task helper below delegates here for the real thing.
    """
    if to_date < from_date:
        return []
    if rrule:
        dtstart = datetime.combine(start_date, time.min)
        rule = rrulestr(rrule, dtstart=dtstart)
        lo = datetime.combine(max(from_date, start_date), time.min)
        hi = datetime.combine(to_date, time.max)
        return [o.date() for o in rule.between(lo, hi, inc=True)]
    if from_date <= start_date <= to_date:
        return [start_date]
    return []


def _task_occurrence_dates(task: Task, from_date: date, to_date: date) -> list[date]:
    """Expand a task's schedule to the occurrence dates within [from_date, to_date].

    Tasks recur on whole dates (no time-of-day). ``rrule`` is anchored at
    ``start_date``; with no rrule the task is a single dated to-do on ``start_date``.
    """
    return _expand_rrule(task.rrule, task.start_date, from_date, to_date)


# ── Rotation resolution (F27 — cadence decoupled from recurrence) ──────────────

def _active_roster(task: Task) -> list["Member"]:
    """Assigned members in rotation order, with soft-deleted members dropped."""
    return [
        a.member
        for a in sorted(task.assignments, key=lambda a: a.sort_order)
        if getattr(a, "member", None) and not a.member.deleted_at
    ]


def _week_ordinal(d: date) -> int:
    # Monotonic, Monday-aligned week index (date.toordinal()==1 is a Monday).
    return (d.toordinal() - 1) // 7


def _month_ordinal(d: date) -> int:
    return d.year * 12 + (d.month - 1)


def _rotation_bucket(task: Task, d: date, occ_index: int) -> int:
    """Which rotation period ``d`` falls in — the assignee is ``roster[bucket % n]``.

    Counted from the rotation anchor (``rotation_anchor_date`` or ``start_date``).
    Time units use calendar-aligned boundaries (weeks flip Monday, months on the
    1st); ``occurrence`` counts the task's own occurrences, so ``occurrence``/1
    reproduces the original per-occurrence rotation.
    """
    n = task.rotation_interval or 1
    if task.rotation_unit == RotationUnit.occurrence:
        return occ_index // n
    anchor = task.rotation_anchor_date or task.start_date
    if task.rotation_unit == RotationUnit.day:
        return (d.toordinal() - anchor.toordinal()) // n
    if task.rotation_unit == RotationUnit.week:
        return (_week_ordinal(d) - _week_ordinal(anchor)) // n
    if task.rotation_unit == RotationUnit.month:
        return (_month_ordinal(d) - _month_ordinal(anchor)) // n
    return occ_index // n


def _rotation_overrides(task: Task) -> dict[date, TaskRotationOverride]:
    """Manual per-occurrence reassignments (swap/skip) that win over the rotation.

    Keyed by ``occurrence_date`` — a stable key, unaffected by later cadence/anchor
    edits (a stale override on a date that's no longer an occurrence simply never
    applies). ``member_id is None`` on a row means *skip* (no assignee).
    """
    return {o.occurrence_date: o for o in task.rotation_overrides}


def _override_target_dates(task: Task, occurrence_date: date, scope: str) -> list[date]:
    """The occurrence dates an override write touches.

    ``"occurrence"`` → just that date. ``"turn"`` → every occurrence sharing that
    date's rotation bucket (so "skip my whole week" is one action even when the
    chore recurs daily). Bounded to ~a year ahead so an open-ended daily series
    can't expand unboundedly.
    """
    if scope != "turn":
        return [occurrence_date]
    upper = occurrence_date + timedelta(days=366)
    all_dates = _task_occurrence_dates(task, task.start_date, upper)
    if occurrence_date not in all_dates:
        return [occurrence_date]
    index_by_date = {d: i for i, d in enumerate(all_dates)}
    target = _rotation_bucket(task, occurrence_date, index_by_date[occurrence_date])
    return [d for d in all_dates if _rotation_bucket(task, d, index_by_date[d]) == target]


# ── Eager-load options ────────────────────────────────────────────────────────

_TASK_LOADS = [
    selectinload(Task.assignments).selectinload(TaskAssignment.member),
    selectinload(Task.completions),
    selectinload(Task.rotation_overrides),
]


async def _reload_task(task_id: uuid.UUID, session: AsyncSession) -> Task:
    result = await session.execute(
        select(Task)
        .where(Task.id == task_id)
        .options(*_TASK_LOADS)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


# ── Routine CRUD ──────────────────────────────────────────────────────────────

async def list_routines(family_id: uuid.UUID, session: AsyncSession) -> list[Routine]:
    result = await session.execute(
        select(Routine)
        .where(Routine.family_id == family_id, Routine.deleted_at.is_(None))
        .options(
            selectinload(Routine.tasks).selectinload(Task.assignments).selectinload(
                TaskAssignment.member
            )
        )
        .order_by(Routine.sort_order, Routine.name)
        .execution_options(populate_existing=True)
    )
    # Soft-deleted tasks are filtered + ordered by RoutineOut at serialization time.
    return list(result.scalars())


_ROUTINE_LOADS = [
    selectinload(Routine.tasks).selectinload(Task.assignments).selectinload(TaskAssignment.member)
]


async def _reload_routine(routine_id: uuid.UUID, session: AsyncSession) -> Routine:
    result = await session.execute(
        select(Routine)
        .where(Routine.id == routine_id)
        .options(*_ROUTINE_LOADS)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def get_routine(
    routine_id: uuid.UUID, family_id: uuid.UUID, session: AsyncSession
) -> Routine | None:
    result = await session.execute(
        select(Routine).where(
            Routine.id == routine_id,
            Routine.family_id == family_id,
            Routine.deleted_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def create_routine(
    family_id: uuid.UUID, data: RoutineCreate, session: AsyncSession
) -> Routine:
    routine = Routine(family_id=family_id, **data.model_dump())
    session.add(routine)
    await session.commit()
    return await _reload_routine(routine.id, session)


async def update_routine(routine: Routine, data: RoutineUpdate, session: AsyncSession) -> Routine:
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(routine, k, v)
    await session.commit()
    return await _reload_routine(routine.id, session)


async def soft_delete_routine(routine: Routine, session: AsyncSession) -> None:
    """Soft-delete the routine and un-group (don't delete) its tasks."""
    result = await session.execute(
        select(Task).where(Task.routine_id == routine.id, Task.deleted_at.is_(None))
    )
    for task in result.scalars():
        task.routine_id = None
    routine.deleted_at = utcnow()
    await session.commit()


# ── Task CRUD ─────────────────────────────────────────────────────────────────

async def get_task(
    task_id: uuid.UUID, family_id: uuid.UUID, session: AsyncSession
) -> Task | None:
    result = await session.execute(
        select(Task)
        .where(Task.id == task_id, Task.family_id == family_id, Task.deleted_at.is_(None))
        .options(*_TASK_LOADS)
        # Refresh cached collections (assignments/completions) on a re-query after a
        # write in the same session — otherwise they come back stale (CLAUDE.md gotcha).
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def list_tasks(family_id: uuid.UUID, session: AsyncSession) -> list[Task]:
    result = await session.execute(
        select(Task)
        .where(Task.family_id == family_id, Task.deleted_at.is_(None))
        .options(*_TASK_LOADS)
        .order_by(Task.sort_order, Task.title)
        .execution_options(populate_existing=True)
    )
    return list(result.scalars())


async def create_task(family_id: uuid.UUID, data: TaskCreate, session: AsyncSession) -> Task:
    if data.routine_id is not None:
        routine = await get_routine(data.routine_id, family_id, session)
        if routine is None:
            raise ValueError("Routine not found")

    task = Task(
        family_id=family_id,
        routine_id=data.routine_id,
        title=data.title,
        description=data.description,
        color=data.color,
        start_date=data.start_date or date.today(),
        rrule=data.rrule,
        sort_order=data.sort_order,
        assignment_strategy=data.assignment_strategy,
        rotation_unit=data.rotation_unit,
        rotation_interval=data.rotation_interval,
        rotation_anchor_date=data.rotation_anchor_date,
        star_value=data.star_value,
        estimated_minutes=data.estimated_minutes,
    )
    session.add(task)
    await session.flush()

    # member_ids order == rotation roster order (sort_order).
    for i, mid in enumerate(data.member_ids):
        session.add(TaskAssignment(task_id=task.id, member_id=mid, sort_order=i))

    await session.commit()
    return await _reload_task(task.id, session)


async def _replace_assignments(
    task: Task, member_ids: list[uuid.UUID] | None, session: AsyncSession
) -> None:
    if member_ids is None:
        return
    for a in list(task.assignments):
        await session.delete(a)
    await session.flush()
    for i, mid in enumerate(member_ids):
        session.add(TaskAssignment(task_id=task.id, member_id=mid, sort_order=i))


async def update_task(
    task: Task, data: TaskUpdate, family_id: uuid.UUID, session: AsyncSession
) -> Task:
    if data.routine_id is not None:
        routine = await get_routine(data.routine_id, family_id, session)
        if routine is None:
            raise ValueError("Routine not found")

    fields = data.model_dump(exclude_unset=True)
    # Nullable columns accept an explicit None (ungroup a task, clear its rrule or
    # notes, reset the rotation anchor back to start_date); required columns ignore
    # None so a partial update can't blank them.
    for k in (
        "routine_id",
        "description",
        "color",
        "rrule",
        "rotation_anchor_date",
        "estimated_minutes",
    ):
        if k in fields:
            setattr(task, k, fields[k])
    for k in (
        "title",
        "start_date",
        "sort_order",
        "assignment_strategy",
        "rotation_unit",
        "rotation_interval",
        "star_value",
    ):
        if k in fields and fields[k] is not None:
            setattr(task, k, fields[k])

    await _replace_assignments(task, data.member_ids, session)
    await session.commit()
    return await _reload_task(task.id, session)


async def soft_delete_task(task: Task, session: AsyncSession) -> None:
    task.deleted_at = utcnow()
    await session.commit()


# ── Completion ────────────────────────────────────────────────────────────────

async def _validate_member(
    member_id: uuid.UUID, family_id: uuid.UUID, session: AsyncSession
) -> None:
    result = await session.execute(
        select(Member.id).where(
            Member.id == member_id,
            Member.family_id == family_id,
            Member.deleted_at.is_(None),
        )
    )
    if result.scalar_one_or_none() is None:
        raise ValueError("Member not found in this family")


async def complete_task(
    task: Task,
    member_id: uuid.UUID,
    occurrence_date: date,
    family_id: uuid.UUID,
    session: AsyncSession,
) -> TaskCompletion:
    await _validate_member(member_id, family_id, session)
    existing = next(
        (
            c
            for c in task.completions
            if c.member_id == member_id and c.occurrence_date == occurrence_date
        ),
        None,
    )
    if existing is not None:
        return existing  # idempotent (no double star award)
    comp = TaskCompletion(
        task_id=task.id,
        member_id=member_id,
        occurrence_date=occurrence_date,
        completed_at=utcnow(),
        stars_awarded=task.star_value,  # snapshot for F14 star math
    )
    session.add(comp)
    await session.commit()
    await session.refresh(comp)
    return comp


async def uncomplete_task(
    task: Task, member_id: uuid.UUID, occurrence_date: date, session: AsyncSession
) -> None:
    existing = next(
        (
            c
            for c in task.completions
            if c.member_id == member_id and c.occurrence_date == occurrence_date
        ),
        None,
    )
    if existing is not None:
        await session.delete(existing)
        await session.commit()


# ── Move to today (re-phase a recurring chore's cadence) ─────────────────────────


def _rrule_until(rrule: str) -> date | None:
    """The end date of an rrule's ``UNTIL``, if any. We write UNTIL as a bare
    ``YYYYMMDD`` (see the FE's recurrence helpers), possibly with a trailing time —
    take the leading date part."""
    raw = _parse_rrule_parts(rrule).get("UNTIL")
    if not raw:
        return None
    digits = raw[:8]
    try:
        return datetime.strptime(digits, "%Y%m%d").date()
    except ValueError:
        return None


async def move_task_to_today(
    task: Task,
    member_id: uuid.UUID | None,
    family_id: uuid.UUID,
    session: AsyncSession,
    *,
    today: date | None = None,
) -> tuple[Task, bool]:
    """Re-anchor a recurring chore's recurrence to today so its cadence re-phases
    from today (e.g. every-other-day → today, +2, +4…), fixing the "did it today but
    it still wants tomorrow" problem for a chore whose occurrence was missed.

    Only interval-style cadences re-phase off the anchor; ``BYDAY=``/``BYMONTHDAY=``
    rules pin explicit calendar days and are rejected. Optionally records today's
    completion for ``member_id`` (the Missed-row flow). Returns ``(task, completed)``.
    """
    today = today or date.today()

    rrule = task.rrule
    if not rrule:
        raise ValueError("Only recurring chores can be moved to today")
    if "BYDAY=" in rrule or "BYMONTHDAY=" in rrule:
        raise ValueError("This chore is pinned to specific days and can't be re-phased")
    until = _rrule_until(rrule)
    if until is not None and until < today:
        raise ValueError("This chore's repeat has already ended")

    # Preserve the rotation phase for time-based rotations (week/month) that lean on
    # start_date as their anchor — moving start_date shouldn't jump whose turn it is.
    # Occurrence-unit rotations re-index from the new start (legacy behaviour).
    if task.rotation_anchor_date is None and task.rotation_unit != RotationUnit.occurrence:
        task.rotation_anchor_date = task.start_date

    task.start_date = today

    completed = False
    if member_id is not None:
        # Reuses validation + idempotency + star snapshot; commits internally.
        await complete_task(task, member_id, today, family_id, session)
        completed = True
    else:
        await session.commit()

    return await _reload_task(task.id, session), completed


# ── Rotation overrides (swap / skip — F27) ──────────────────────────────────────

async def set_rotation_override(
    task: Task,
    occurrence_date: date,
    member_id: uuid.UUID | None,
    scope: str,
    family_id: uuid.UUID,
    session: AsyncSession,
) -> list[TaskRotationOverride]:
    """Reassign (``member_id`` set) or skip (``member_id`` None) a turn.

    ``scope="turn"`` applies it to every occurrence in the same rotation bucket so a
    multi-day turn (e.g. a whole week) is handled in one call. Idempotent per date.
    """
    if task.assignment_strategy != AssignmentStrategy.rotating:
        raise ValueError("Overrides apply to rotating tasks only")
    if member_id is not None:
        await _validate_member(member_id, family_id, session)

    targets = _override_target_dates(task, occurrence_date, scope)
    by_date = {o.occurrence_date: o for o in task.rotation_overrides}
    for d in targets:
        existing = by_date.get(d)
        if existing is not None:
            existing.member_id = member_id
        else:
            session.add(
                TaskRotationOverride(task_id=task.id, occurrence_date=d, member_id=member_id)
            )
    await session.commit()
    task = await _reload_task(task.id, session)
    target_set = set(targets)
    return [o for o in task.rotation_overrides if o.occurrence_date in target_set]


async def clear_rotation_override(
    task: Task, occurrence_date: date, scope: str, session: AsyncSession
) -> None:
    """Drop the override(s), reverting to the computed rotation."""
    targets = set(_override_target_dates(task, occurrence_date, scope))
    for o in list(task.rotation_overrides):
        if o.occurrence_date in targets:
            await session.delete(o)
    await session.commit()


# ── Streaks ───────────────────────────────────────────────────────────────────

def compute_streak(task: Task, member_id: uuid.UUID, as_of: date) -> tuple[int, int]:
    """Return ``(current, longest)`` completion streaks for a member, in occurrences.

    A streak counts consecutive *occurrences the member was responsible for* that
    they completed. For a rotating chore that's only the member's own turns — a
    week (or month) owned by someone else doesn't break the run; for a fixed chore
    it's every occurrence. The most recent due occurrence being today and still
    pending is not counted as a miss — the streak reflects the run up to the last
    due day.
    """
    occ_dates = sorted(_task_occurrence_dates(task, task.start_date, as_of))

    roster = _active_roster(task)
    if task.assignment_strategy == AssignmentStrategy.rotating and roster:
        # Restrict to this member's turns, resolved exactly as the occurrence view
        # does (bucket maths + overrides), so streaks agree with what's on the board.
        # A swapped-away turn isn't this member's; a skip is nobody's.
        roster_ids = [m.id for m in roster]
        overrides = _rotation_overrides(task)
        index_by_date = {d: i for i, d in enumerate(occ_dates)}

        def _effective_assignee(d: date) -> uuid.UUID | None:
            override = overrides.get(d)
            if override is not None:
                return override.member_id  # None on a skip → nobody's turn
            return roster_ids[_rotation_bucket(task, d, index_by_date[d]) % len(roster_ids)]

        relevant = [d for d in occ_dates if _effective_assignee(d) == member_id]
    else:
        relevant = occ_dates

    completed = {c.occurrence_date for c in task.completions if c.member_id == member_id}

    longest = run = 0
    for d in relevant:
        if d in completed:
            run += 1
            longest = max(longest, run)
        else:
            run = 0

    # Current = trailing run; let a still-pending most-recent due occurrence slide.
    seq = list(relevant)
    if seq and seq[-1] == as_of and seq[-1] not in completed:
        seq = seq[:-1]
    current = 0
    for d in reversed(seq):
        if d in completed:
            current += 1
        else:
            break
    return current, longest


# ── Occurrence expansion (range → per-member completion state) ────────────────

async def get_task_occurrences(
    family_id: uuid.UUID, from_date: date, to_date: date, session: AsyncSession
) -> list[TaskOccurrenceOut]:
    tasks = await list_tasks(family_id, session)

    # All active members, so a swap can reassign to anyone in the family — not just
    # the chore's roster.
    members_res = await session.execute(
        select(Member).where(Member.family_id == family_id, Member.deleted_at.is_(None))
    )
    member_briefs: dict[uuid.UUID, MemberBrief] = {
        m.id: MemberBrief(id=m.id, name=m.name, color=m.color) for m in members_res.scalars()
    }

    results: list[TaskOccurrenceOut] = []
    for task in tasks:
        # Active roster in rotation order; soft-deleted members drop out (F27).
        roster = _active_roster(task)
        rotating = task.assignment_strategy == AssignmentStrategy.rotating and len(roster) > 0

        if rotating:
            # The bucket (and the occurrence index it may need) is anchored at the
            # series start, so expand from start_date to know each date's index.
            all_dates = _task_occurrence_dates(task, task.start_date, to_date)
            index_by_date = {d: i for i, d in enumerate(all_dates)}
            dates = [d for d in all_dates if d >= from_date]
            overrides = _rotation_overrides(task)
        else:
            dates = _task_occurrence_dates(task, from_date, to_date)
        if not dates:
            continue

        roster_briefs = [MemberBrief(id=m.id, name=m.name, color=m.color) for m in roster]

        completed_by_date: dict[date, list[uuid.UUID]] = {}
        for c in task.completions:
            completed_by_date.setdefault(c.occurrence_date, []).append(c.member_id)

        for d in dates:
            up_next: MemberBrief | None = None
            is_overridden = False
            is_skipped = False
            if rotating:
                bucket = _rotation_bucket(task, d, index_by_date[d])
                members = [roster_briefs[bucket % len(roster_briefs)]]
                if len(roster_briefs) > 1:
                    up_next = roster_briefs[(bucket + 1) % len(roster_briefs)]
                # A manual reassignment (swap/skip) wins over the computed assignee.
                override = overrides.get(d)
                if override is not None:
                    is_overridden = True
                    if override.member_id is None:
                        members = []  # skip — no one is on the hook
                        is_skipped = True
                    else:
                        brief = member_briefs.get(override.member_id)
                        members = [brief] if brief else []
            else:
                members = roster_briefs
            color = _resolve_task_color(task.color, [m.color for m in members])
            results.append(
                TaskOccurrenceOut(
                    task_id=task.id,
                    routine_id=task.routine_id,
                    title=task.title,
                    description=task.description,
                    occurrence_date=d,
                    effective_color=color,
                    is_recurring=bool(task.rrule),
                    star_value=task.star_value,
                    rotation_unit=task.rotation_unit,
                    rotation_interval=task.rotation_interval,
                    members=members,
                    completed_member_ids=sorted(completed_by_date.get(d, []), key=str),
                    up_next=up_next,
                    is_overridden=is_overridden,
                    is_skipped=is_skipped,
                )
            )

    results.sort(key=lambda o: (o.occurrence_date, o.title))
    return results


# ── Chore balancer (auto day / who-starts planning) ─────────────────────────────
#
# Picks each managed chore's day and rotation phase to even out the load. The
# heavy lifting is the pure optimizer in app.services.chore_balancer; the code
# here adapts ORM tasks ↔ optimizer inputs, expanding candidate placements with
# the real recurrence engine and resolving current ("before") load exactly as the
# occurrence view does — so the preview matches what the device will show.

_WD_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
_WD_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
_WD_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
_MONTHLY_DOMS = [1, 8, 15, 22]  # candidate days-of-month to spread monthly chores
# Minutes assumed for a chore with no time estimate — used for recurring chores
# the user left out of the plan but that still load the household.
_DEFAULT_MINUTES = 15.0


def _parse_rrule_parts(rrule: str) -> dict[str, str]:
    parts: dict[str, str] = {}
    for token in rrule.split(";"):
        if "=" in token:
            k, v = token.split("=", 1)
            parts[k.strip().upper()] = v.strip()
    return parts


def _build_rrule(parts: dict[str, str]) -> str:
    order = ["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH", "UNTIL", "COUNT"]
    keys = [k for k in order if k in parts] + [k for k in parts if k not in order]
    return ";".join(f"{k}={parts[k]}" for k in keys)


def _ordinal(n: int) -> str:
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def _with_day_of_month(base_start: date, dom: int, today: date) -> date:
    """A monthly anchor on day ``dom`` (clamped ≤28), in the current/next due month."""
    anchor = max(base_start, today)
    day = min(dom, 28)
    candidate = date(anchor.year, anchor.month, day)
    if candidate < today:
        year = anchor.year + (1 if anchor.month == 12 else 0)
        month = 1 if anchor.month == 12 else anchor.month + 1
        candidate = date(year, month, day)
    return candidate


def _placements(
    task: Task, allowed_wd: list[int], lock_day: bool, today: date, horizon_end: date
) -> list[tuple[dict, list[date]]]:
    """Candidate (placement-meta, horizon-occurrence-dates) options for a chore.

    A weekly single-day chore offers one candidate per allowed weekday; a monthly
    chore one per candidate day-of-month; everything else (daily, multi-day weekly,
    locked) a single keep-its-days candidate. Meta carries the resulting rrule /
    start_date and a human ``day_label`` for the summary.
    """
    rrule = task.rrule
    parts = _parse_rrule_parts(rrule) if rrule else {}
    freq = parts.get("FREQ", "")
    bydays = [d for d in parts.get("BYDAY", "").split(",") if d]

    def keep(label: str, wd: int | None = None) -> list[tuple[dict, list[date]]]:
        occ = _expand_rrule(rrule, task.start_date, today, horizon_end)
        meta = {
            "kind": "keep",
            "weekday": wd,
            "rrule": rrule,
            # Re-anchor to the soonest occurrence today-onward so the applied plan
            # starts today and the chore's pre-today occurrences stop generating.
            "start_date": occ[0] if occ else task.start_date,
            "day_label": label,
        }
        return [(meta, occ)]

    # Weekly, single day (incl. plain weekly / every-N-weeks): free to pick a weekday.
    if freq == "WEEKLY" and len(bydays) <= 1:
        current_wd = (
            _WD_CODES.index(bydays[0]) if bydays else task.start_date.weekday()
        )
        if lock_day:
            return keep(f"{_WD_FULL[current_wd]}s", current_wd)
        candidates: list[tuple[dict, list[date]]] = []
        for wd in allowed_wd:
            new_parts = dict(parts)
            new_parts["BYDAY"] = _WD_CODES[wd]
            rr = _build_rrule(new_parts)
            occ = _expand_rrule(rr, task.start_date, today, horizon_end)
            candidates.append(
                (
                    {
                        "kind": "weekday",
                        "weekday": wd,
                        "rrule": rr,
                        "start_date": occ[0] if occ else task.start_date,
                        "day_label": f"{_WD_FULL[wd]}s",
                    },
                    occ,
                )
            )
        return candidates

    # Monthly: free to pick a day-of-month.
    if freq == "MONTHLY":
        if lock_day:
            return keep(f"the {_ordinal(task.start_date.day)} of the month")
        candidates = []
        for dom in _MONTHLY_DOMS:
            sd = _with_day_of_month(task.start_date, dom, today)
            occ = _expand_rrule(rrule, sd, today, horizon_end)
            candidates.append(
                (
                    {
                        "kind": "dom",
                        "weekday": None,
                        "rrule": rrule,
                        "start_date": occ[0] if occ else sd,
                        "day_label": f"the {_ordinal(min(dom, 28))} of the month",
                    },
                    occ,
                )
            )
        return candidates

    # Daily / multi-day weekly / anything else: keep the day pattern, balance phase.
    if freq == "DAILY":
        return keep("every day")
    if freq == "WEEKLY" and len(bydays) > 1:
        label = ", ".join(_WD_SHORT[_WD_CODES.index(c)] for c in bydays if c in _WD_CODES)
        return keep(label or "its usual days")
    return keep("its usual days")


def _add_current_load(
    task: Task,
    effort: float,
    today: date,
    horizon_end: date,
    people_index: dict[uuid.UUID, int],
    loads: Loads,
) -> None:
    """Add a task's *current* schedule load to ``loads`` (real-engine resolved)."""
    all_dates = _task_occurrence_dates(task, task.start_date, horizon_end)
    index_by_date = {d: i for i, d in enumerate(all_dates)}
    roster = _active_roster(task)
    roster_ids = [m.id for m in roster]
    rotating = task.assignment_strategy == AssignmentStrategy.rotating and bool(roster_ids)
    overrides = _rotation_overrides(task) if rotating else {}

    for d in all_dates:
        if d < today:
            continue
        if rotating:
            override = overrides.get(d)
            if override is not None:
                assignees = [override.member_id] if override.member_id else []
            else:
                bucket = _rotation_bucket(task, d, index_by_date[d])
                assignees = [roster_ids[bucket % len(roster_ids)]]
        else:
            assignees = roster_ids
        if not assignees:
            continue
        share = effort / len(assignees)
        for mid in assignees:
            p = people_index.get(mid)
            if p is None:
                continue
            loads.add(p, d.toordinal(), share)


async def compute_balance_plan(
    family_id: uuid.UUID,
    req: BalancePlanRequest,
    session: AsyncSession,
    *,
    today: date | None = None,
) -> BalancePlanOut:
    today = today or date.today()
    horizon_end = today + timedelta(days=req.horizon_days - 1)
    weeks = req.horizon_days / 7

    tasks = await list_tasks(family_id, session)
    by_id = {t.id: t for t in tasks}

    members_res = await session.execute(
        select(Member).where(Member.family_id == family_id, Member.deleted_at.is_(None))
    )
    member_by_id = {m.id: m for m in members_res.scalars()}

    people = [mid for mid in req.member_ids if mid in member_by_id]
    if not people:
        raise ValueError("No valid members to balance between")
    people_index = {mid: i for i, mid in enumerate(people)}
    num_people = len(people)

    shares = req.shares or [1.0] * num_people
    total_share = sum(shares) or 1.0
    shares = [s / total_share for s in shares]

    allowed_wd = sorted({w for w in (req.allowed_weekdays or []) if 0 <= w <= 6})
    if not allowed_wd:
        allowed_wd = list(range(7))

    weekday_counts = [0] * 7
    d = today
    while d <= horizon_end:
        weekday_counts[d.weekday()] += 1
        d += timedelta(days=1)

    listed_ids = {it.task_id for it in req.items}

    # Background: kept items at their current schedule + recurring chores left out
    # of the plan entirely (they still happen and load people).
    background = Loads(num_people)
    for it in req.items:
        if it.mode == "keep":
            task = by_id.get(it.task_id)
            if task is not None:
                _add_current_load(
                    task, float(it.minutes), today, horizon_end, people_index, background
                )
    for task in tasks:
        if task.id in listed_ids or not task.rrule:
            continue
        minutes = float(task.estimated_minutes or _DEFAULT_MINUTES)
        _add_current_load(task, minutes, today, horizon_end, people_index, background)

    # "Before" = background + the managed chores at their *current* schedule.
    before = background.copy()
    managed = [it for it in req.items if it.mode in ("rotate", "fixed")]
    for it in managed:
        task = by_id.get(it.task_id)
        if task is not None:
            _add_current_load(task, float(it.minutes), today, horizon_end, people_index, before)

    # Build optimizer inputs + keep the placement metadata in lock-step.
    opt_items: list[OptItem] = []
    metas: list[list[tuple[dict, list[date]]]] = []
    valid: list[tuple] = []  # (item, task)
    for it in managed:
        task = by_id.get(it.task_id)
        if task is None:
            continue
        cands = _placements(task, allowed_wd, it.lock_day, today, horizon_end)
        if not cands:
            continue
        fixed_p = people_index.get(it.fixed_member_id) if it.mode == "fixed" else None
        opt_items.append(
            OptItem(
                candidates=[[dd.toordinal() for dd in occ] for (_meta, occ) in cands],
                effort=float(it.minutes),
                mode=it.mode,
                fixed_p=fixed_p,
            )
        )
        metas.append(cands)
        valid.append((it, task))

    choices = optimize(opt_items, num_people, shares, background, weeks, req.seed)

    # Apply choices into "after" loads and build the per-task changes.
    after = background.copy()
    changes: list[BalanceChangeOut] = []
    for idx, (it, task) in enumerate(valid):
        cand_idx, starter = choices[idx]
        meta, occ = metas[idx][cand_idx]
        for i, dd in enumerate(occ):
            if it.mode == "rotate":
                p = (starter + i) % num_people
            else:
                p = people_index.get(it.fixed_member_id)
            if p is None:
                continue
            after.add(p, dd.toordinal(), float(it.minutes))

        rr = meta["rrule"]
        sd = meta["start_date"]
        day_label = meta["day_label"]
        if it.mode == "rotate":
            # Member order such that the engine assigns the chosen starter to the
            # first horizon occurrence: roster[k0 % P] must be people[starter].
            series = _expand_rrule(rr, sd, sd, horizon_end)
            k0 = next((i for i, dd in enumerate(series) if dd >= today), 0)
            rot = (starter - k0) % num_people
            member_ids = [people[(j + rot) % num_people] for j in range(num_people)]
            starter_id = people[starter]
            who = member_by_id[starter_id].name
            summary = f"{day_label[:1].upper()}{day_label[1:]} · {who} starts"
            changes.append(
                BalanceChangeOut(
                    task_id=task.id,
                    title=task.title,
                    rrule=rr,
                    start_date=sd,
                    assignment_strategy=AssignmentStrategy.rotating,
                    rotation_unit=RotationUnit.occurrence,
                    rotation_interval=1,
                    rotation_anchor_date=None,
                    member_ids=member_ids,
                    weekday=meta["weekday"],
                    starter_id=starter_id,
                    summary=summary,
                )
            )
        else:  # fixed
            who = (
                member_by_id[it.fixed_member_id].name
                if it.fixed_member_id in member_by_id
                else "?"
            )
            summary = f"{day_label[:1].upper()}{day_label[1:]} · always {who}"
            changes.append(
                BalanceChangeOut(
                    task_id=task.id,
                    title=task.title,
                    rrule=rr,
                    start_date=sd,
                    assignment_strategy=AssignmentStrategy.fixed,
                    rotation_unit=RotationUnit.occurrence,
                    rotation_interval=1,
                    rotation_anchor_date=None,
                    member_ids=[it.fixed_member_id],
                    weekday=meta["weekday"],
                    starter_id=it.fixed_member_id,
                    summary=summary,
                )
            )

    def busiest(loads: Loads) -> float:
        # The single heaviest day one person carries — the "buried" metric.
        return max((max(v) for v in loads.per_date.values()), default=0.0)

    def spread(loads: Loads) -> float:
        weekly = [x / weeks for x in loads.per_person]
        return max(weekly) - min(weekly) if weekly else 0.0

    people_out = [
        BalancePersonOut(
            member_id=people[p],
            name=member_by_id[people[p]].name,
            color=member_by_id[people[p]].color,
            before_per_week=round(before.per_person[p] / weeks, 2),
            after_per_week=round(after.per_person[p] / weeks, 2),
        )
        for p in range(num_people)
    ]
    # A smooth "typical week" heatmap: each weekday's per-person average over the horizon.
    wd_sum = [[0.0] * 7 for _ in range(num_people)]
    for ordinal, vec in after.per_date.items():
        wd = date.fromordinal(ordinal).weekday()
        for p in range(num_people):
            wd_sum[p][wd] += vec[p]
    weekday_loads = [
        {
            str(people[p]): round(wd_sum[p][wd] / (weekday_counts[wd] or 1), 2)
            for p in range(num_people)
        }
        for wd in range(7)
    ]
    preview = BalancePreviewOut(
        people=people_out,
        weekday_loads=weekday_loads,
        busiest_before=round(busiest(before), 2),
        busiest_after=round(busiest(after), 2),
        imbalance_before=round(spread(before), 2),
        imbalance_after=round(spread(after), 2),
    )
    return BalancePlanOut(
        seed=req.seed, horizon_days=req.horizon_days, changes=changes, preview=preview
    )


async def apply_balance_plan(
    family_id: uuid.UUID,
    req: BalancePlanRequest,
    session: AsyncSession,
    *,
    today: date | None = None,
) -> int:
    """Recompute the plan for ``req`` (deterministic per seed) and write every change.

    Also persists each item's time estimate back to its task, so estimates entered
    in the wizard stick and port in next time.
    """
    plan = await compute_balance_plan(family_id, req, session, today=today)
    minutes_by_id = {it.task_id: it.minutes for it in req.items}
    changed_ids = {c.task_id for c in plan.changes}
    updated = 0
    for change in plan.changes:
        task = await get_task(change.task_id, family_id, session)
        if task is None:
            continue
        task.rrule = change.rrule
        task.start_date = change.start_date
        task.assignment_strategy = change.assignment_strategy
        task.rotation_unit = change.rotation_unit
        task.rotation_interval = change.rotation_interval
        task.rotation_anchor_date = change.rotation_anchor_date
        task.estimated_minutes = minutes_by_id.get(change.task_id, task.estimated_minutes)
        await _replace_assignments(task, change.member_ids, session)
        updated += 1
    # Keep/unchanged items: persist their estimate even though their schedule stands.
    for it in req.items:
        if it.task_id in changed_ids:
            continue
        task = await get_task(it.task_id, family_id, session)
        if task is not None:
            task.estimated_minutes = it.minutes
    await session.commit()
    return updated
