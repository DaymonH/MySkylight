import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.validation import occurrence_window
from app.deps import AnyFamilyMember, FamilyOwnerOrAdult, require_family_role
from app.models.family import Family, Membership, MembershipRole
from app.schemas.task import (
    BalanceApplyOut,
    BalancePlanOut,
    BalancePlanRequest,
    CompletionCreate,
    CompletionOut,
    MoveToTodayRequest,
    RotationOverrideOut,
    RotationOverrideSet,
    RoutineCreate,
    RoutineOut,
    RoutineUpdate,
    StreakOut,
    TaskCreate,
    TaskOccurrenceOut,
    TaskOut,
    TaskUpdate,
)
from app.services import tasks as svc
from app.services.realtime import bus

router = APIRouter(tags=["tasks"])

# Children may check tasks off; viewers are read-only.
FamilyActor = Annotated[
    tuple[Family, Membership],
    Depends(require_family_role(MembershipRole.owner, MembershipRole.adult, MembershipRole.child)),
]


# ── Routines ──────────────────────────────────────────────────────────────────

@router.get("/families/{family_id}/routines", response_model=list[RoutineOut])
async def list_routines(
    family_id: uuid.UUID,
    _auth: AnyFamilyMember,
    session: AsyncSession = Depends(get_session),
):
    routines = await svc.list_routines(family_id, session)
    return [RoutineOut.model_validate(r) for r in routines]


@router.post("/families/{family_id}/routines", response_model=RoutineOut, status_code=201)
async def create_routine(
    family_id: uuid.UUID,
    data: RoutineCreate,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    routine = await svc.create_routine(family_id, data, session)
    await bus.publish(str(family_id), "routine.created", {"id": str(routine.id)})
    return RoutineOut.model_validate(routine)


@router.patch("/families/{family_id}/routines/{routine_id}", response_model=RoutineOut)
async def update_routine(
    family_id: uuid.UUID,
    routine_id: uuid.UUID,
    data: RoutineUpdate,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    routine = await svc.get_routine(routine_id, family_id, session)
    if not routine:
        raise HTTPException(404, "Routine not found")
    routine = await svc.update_routine(routine, data, session)
    await bus.publish(str(family_id), "routine.updated", {"id": str(routine.id)})
    return RoutineOut.model_validate(routine)


@router.delete("/families/{family_id}/routines/{routine_id}", status_code=204)
async def delete_routine(
    family_id: uuid.UUID,
    routine_id: uuid.UUID,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    routine = await svc.get_routine(routine_id, family_id, session)
    if not routine:
        raise HTTPException(404, "Routine not found")
    await svc.soft_delete_routine(routine, session)
    await bus.publish(str(family_id), "routine.deleted", {"id": str(routine_id)})


# ── Tasks ─────────────────────────────────────────────────────────────────────

@router.get("/families/{family_id}/tasks/occurrences", response_model=list[TaskOccurrenceOut])
async def get_task_occurrences(
    family_id: uuid.UUID,
    _auth: AnyFamilyMember,
    window: tuple[date, date] = Depends(occurrence_window),
    session: AsyncSession = Depends(get_session),
):
    from_date, to_date = window
    return await svc.get_task_occurrences(family_id, from_date, to_date, session)


# ── Chore balancer (auto day / who-starts planning) ─────────────────────────────
# Declared before /tasks/{task_id} so the literal path isn't parsed as a task id.

@router.post("/families/{family_id}/tasks/balance-plan", response_model=BalancePlanOut)
async def balance_plan(
    family_id: uuid.UUID,
    data: BalancePlanRequest,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    """Compute (but don't apply) a balanced day/who-starts plan + a before/after preview."""
    try:
        return await svc.compute_balance_plan(family_id, data, session)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/families/{family_id}/tasks/balance-plan/apply", response_model=BalanceApplyOut)
async def apply_balance_plan(
    family_id: uuid.UUID,
    data: BalancePlanRequest,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    """Apply the balanced plan for these inputs (deterministic per seed) in one write."""
    try:
        updated = await svc.apply_balance_plan(family_id, data, session)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await bus.publish(str(family_id), "task.updated", {"source": "balance", "updated": updated})
    return BalanceApplyOut(updated=updated)


@router.get("/families/{family_id}/tasks", response_model=list[TaskOut])
async def list_tasks(
    family_id: uuid.UUID,
    _auth: AnyFamilyMember,
    session: AsyncSession = Depends(get_session),
):
    tasks = await svc.list_tasks(family_id, session)
    return [TaskOut.model_validate(t) for t in tasks]


@router.post("/families/{family_id}/tasks", response_model=TaskOut, status_code=201)
async def create_task(
    family_id: uuid.UUID,
    data: TaskCreate,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    try:
        task = await svc.create_task(family_id, data, session)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await bus.publish(str(family_id), "task.created", {"id": str(task.id)})
    return TaskOut.model_validate(task)


@router.get("/families/{family_id}/tasks/{task_id}", response_model=TaskOut)
async def get_task(
    family_id: uuid.UUID,
    task_id: uuid.UUID,
    _auth: AnyFamilyMember,
    session: AsyncSession = Depends(get_session),
):
    task = await svc.get_task(task_id, family_id, session)
    if not task:
        raise HTTPException(404, "Task not found")
    return TaskOut.model_validate(task)


@router.patch("/families/{family_id}/tasks/{task_id}", response_model=TaskOut)
async def update_task(
    family_id: uuid.UUID,
    task_id: uuid.UUID,
    data: TaskUpdate,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    task = await svc.get_task(task_id, family_id, session)
    if not task:
        raise HTTPException(404, "Task not found")
    try:
        task = await svc.update_task(task, data, family_id, session)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await bus.publish(str(family_id), "task.updated", {"id": str(task.id)})
    return TaskOut.model_validate(task)


@router.delete("/families/{family_id}/tasks/{task_id}", status_code=204)
async def delete_task(
    family_id: uuid.UUID,
    task_id: uuid.UUID,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    task = await svc.get_task(task_id, family_id, session)
    if not task:
        raise HTTPException(404, "Task not found")
    await svc.soft_delete_task(task, session)
    await bus.publish(str(family_id), "task.deleted", {"id": str(task_id)})


# ── Completion & streaks ──────────────────────────────────────────────────────

@router.post(
    "/families/{family_id}/tasks/{task_id}/complete",
    response_model=CompletionOut,
    status_code=201,
)
async def complete_task(
    family_id: uuid.UUID,
    task_id: uuid.UUID,
    data: CompletionCreate,
    _auth: FamilyActor,
    session: AsyncSession = Depends(get_session),
):
    task = await svc.get_task(task_id, family_id, session)
    if not task:
        raise HTTPException(404, "Task not found")
    try:
        comp = await svc.complete_task(
            task, data.member_id, data.occurrence_date, family_id, session
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    await bus.publish(
        str(family_id),
        "task.completed",
        {"id": str(task_id), "member_id": str(data.member_id), "date": str(data.occurrence_date)},
    )
    return CompletionOut(
        task_id=comp.task_id,
        member_id=comp.member_id,
        occurrence_date=comp.occurrence_date,
        completed_at=comp.completed_at,
    )


@router.delete("/families/{family_id}/tasks/{task_id}/complete", status_code=204)
async def uncomplete_task(
    family_id: uuid.UUID,
    task_id: uuid.UUID,
    _auth: FamilyActor,
    member_id: uuid.UUID = Query(...),
    occurrence_date: date = Query(...),
    session: AsyncSession = Depends(get_session),
):
    task = await svc.get_task(task_id, family_id, session)
    if not task:
        raise HTTPException(404, "Task not found")
    await svc.uncomplete_task(task, member_id, occurrence_date, session)
    await bus.publish(
        str(family_id),
        "task.uncompleted",
        {"id": str(task_id), "member_id": str(member_id), "date": str(occurrence_date)},
    )


@router.post(
    "/families/{family_id}/tasks/{task_id}/move-to-today",
    response_model=TaskOut,
)
async def move_task_to_today(
    family_id: uuid.UUID,
    task_id: uuid.UUID,
    data: MoveToTodayRequest,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    """Re-anchor a recurring chore to today so its cadence re-phases from today.

    Interval-style chores only (``BYDAY=``/``BYMONTHDAY=`` are rejected). Optionally
    records today's completion for ``member_id`` (the Missed-row one-tap flow).
    """
    task = await svc.get_task(task_id, family_id, session)
    if not task:
        raise HTTPException(404, "Task not found")
    try:
        task, completed = await svc.move_task_to_today(task, data.member_id, family_id, session)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await bus.publish(str(family_id), "task.updated", {"id": str(task_id), "source": "move"})
    if completed:
        await bus.publish(
            str(family_id),
            "task.completed",
            {"id": str(task_id), "member_id": str(data.member_id), "date": str(task.start_date)},
        )
    return TaskOut.model_validate(task)


@router.get("/families/{family_id}/tasks/{task_id}/streak", response_model=StreakOut)
async def get_streak(
    family_id: uuid.UUID,
    task_id: uuid.UUID,
    _auth: AnyFamilyMember,
    member_id: uuid.UUID = Query(...),
    as_of: date | None = Query(None),
    session: AsyncSession = Depends(get_session),
):
    task = await svc.get_task(task_id, family_id, session)
    if not task:
        raise HTTPException(404, "Task not found")
    current, longest = svc.compute_streak(task, member_id, as_of or date.today())
    return StreakOut(
        task_id=task_id, member_id=member_id, current_streak=current, longest_streak=longest
    )


# ── Rotation overrides (swap / skip — F27) ──────────────────────────────────────

@router.get(
    "/families/{family_id}/tasks/{task_id}/overrides",
    response_model=list[RotationOverrideOut],
)
async def list_rotation_overrides(
    family_id: uuid.UUID,
    task_id: uuid.UUID,
    _auth: AnyFamilyMember,
    session: AsyncSession = Depends(get_session),
):
    task = await svc.get_task(task_id, family_id, session)
    if not task:
        raise HTTPException(404, "Task not found")
    return [RotationOverrideOut.model_validate(o) for o in task.rotation_overrides]


@router.put(
    "/families/{family_id}/tasks/{task_id}/overrides/{occurrence_date}",
    response_model=list[RotationOverrideOut],
)
async def set_rotation_override(
    family_id: uuid.UUID,
    task_id: uuid.UUID,
    occurrence_date: date,
    data: RotationOverrideSet,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    task = await svc.get_task(task_id, family_id, session)
    if not task:
        raise HTTPException(404, "Task not found")
    try:
        rows = await svc.set_rotation_override(
            task, occurrence_date, data.member_id, data.scope, family_id, session
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    await bus.publish(
        str(family_id),
        "task.override_set",
        {"id": str(task_id), "date": str(occurrence_date)},
    )
    return [RotationOverrideOut.model_validate(o) for o in rows]


@router.delete(
    "/families/{family_id}/tasks/{task_id}/overrides/{occurrence_date}", status_code=204
)
async def clear_rotation_override(
    family_id: uuid.UUID,
    task_id: uuid.UUID,
    occurrence_date: date,
    _auth: FamilyOwnerOrAdult,
    scope: str = Query("occurrence"),
    session: AsyncSession = Depends(get_session),
):
    task = await svc.get_task(task_id, family_id, session)
    if not task:
        raise HTTPException(404, "Task not found")
    await svc.clear_rotation_override(task, occurrence_date, scope, session)
    await bus.publish(
        str(family_id),
        "task.override_cleared",
        {"id": str(task_id), "date": str(occurrence_date)},
    )
