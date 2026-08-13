import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.task import AssignmentStrategy, RotationUnit
from app.schemas.event import MemberBrief

# ── Routines ──────────────────────────────────────────────────────────────────


class RoutineCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    sort_order: int = 0


class RoutineUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    sort_order: int | None = None


# ── Tasks ─────────────────────────────────────────────────────────────────────


class TaskCreate(BaseModel):
    routine_id: uuid.UUID | None = None
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    color: str | None = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")
    # Defaults to today (set in the service) when omitted.
    start_date: date | None = None
    rrule: str | None = Field(None, max_length=1000)
    sort_order: int = 0
    assignment_strategy: AssignmentStrategy = AssignmentStrategy.fixed
    # Rotation cadence (F27), independent of `rrule`. `occurrence`/1 == legacy
    # per-occurrence rotation; `rotation_anchor_date` defaults to `start_date`.
    rotation_unit: RotationUnit = RotationUnit.occurrence
    rotation_interval: int = Field(1, ge=1)
    rotation_anchor_date: date | None = None
    star_value: int = Field(1, ge=0)
    # Rough time-to-do in minutes (F30); used by the chore balancer as the load weight.
    estimated_minutes: int | None = Field(None, ge=1, le=1440)
    # Order matters for `rotating`: it's the rotation roster order.
    member_ids: list[uuid.UUID] = []


class TaskUpdate(BaseModel):
    routine_id: uuid.UUID | None = None
    title: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    color: str | None = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")
    start_date: date | None = None
    rrule: str | None = Field(None, max_length=1000)
    sort_order: int | None = None
    assignment_strategy: AssignmentStrategy | None = None
    rotation_unit: RotationUnit | None = None
    rotation_interval: int | None = Field(None, ge=1)
    rotation_anchor_date: date | None = None
    star_value: int | None = Field(None, ge=0)
    estimated_minutes: int | None = Field(None, ge=1, le=1440)
    member_ids: list[uuid.UUID] | None = None


class TaskOut(BaseModel):
    id: uuid.UUID
    family_id: uuid.UUID
    routine_id: uuid.UUID | None
    title: str
    description: str | None
    color: str | None
    start_date: date
    rrule: str | None
    sort_order: int
    assignment_strategy: AssignmentStrategy
    rotation_unit: RotationUnit
    rotation_interval: int
    rotation_anchor_date: date | None
    star_value: int
    estimated_minutes: int | None
    created_at: datetime
    updated_at: datetime
    # The full roster, in rotation order (matters for `rotating`).
    members: list[MemberBrief] = []

    @model_validator(mode="before")
    @classmethod
    def _from_orm(cls, v: Any) -> Any:
        if isinstance(v, dict):
            return v
        assignments = sorted(getattr(v, "assignments", []) or [], key=lambda a: a.sort_order)
        return {
            "id": v.id,
            "family_id": v.family_id,
            "routine_id": v.routine_id,
            "title": v.title,
            "description": v.description,
            "color": v.color,
            "start_date": v.start_date,
            "rrule": v.rrule,
            "sort_order": v.sort_order,
            "assignment_strategy": v.assignment_strategy,
            "rotation_unit": v.rotation_unit,
            "rotation_interval": v.rotation_interval,
            "rotation_anchor_date": v.rotation_anchor_date,
            "star_value": v.star_value,
            "estimated_minutes": v.estimated_minutes,
            "created_at": v.created_at,
            "updated_at": v.updated_at,
            "members": [
                {"id": a.member.id, "name": a.member.name, "color": a.member.color}
                for a in assignments
                if getattr(a, "member", None) and not a.member.deleted_at
            ],
        }


class RoutineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    family_id: uuid.UUID
    name: str
    sort_order: int
    created_at: datetime
    updated_at: datetime
    tasks: list[TaskOut] = []

    @model_validator(mode="before")
    @classmethod
    def _from_orm(cls, v: Any) -> Any:
        if isinstance(v, dict):
            return v
        tasks = [t for t in (getattr(v, "tasks", []) or []) if not getattr(t, "deleted_at", None)]
        tasks.sort(key=lambda t: (t.sort_order, t.title))
        return {
            "id": v.id,
            "family_id": v.family_id,
            "name": v.name,
            "sort_order": v.sort_order,
            "created_at": v.created_at,
            "updated_at": v.updated_at,
            "tasks": tasks,
        }


# ── Occurrences & completion ──────────────────────────────────────────────────


class TaskOccurrenceOut(BaseModel):
    """A single dated instance of a task with its per-member completion state.

    For a ``rotating`` task, ``members`` holds just the one resolved assignee for
    this date and ``up_next`` is who gets it next occurrence; for ``fixed`` tasks
    ``members`` is the full assignee set and ``up_next`` is ``None``.
    """

    task_id: uuid.UUID
    routine_id: uuid.UUID | None
    title: str
    description: str | None
    occurrence_date: date
    effective_color: str
    is_recurring: bool
    star_value: int
    rotation_unit: RotationUnit
    rotation_interval: int
    members: list[MemberBrief]
    completed_member_ids: list[uuid.UUID]
    up_next: MemberBrief | None = None
    # Rotation override state (F27 swap/skip): `is_overridden` = a manual
    # reassignment is in effect; `is_skipped` = excused, no one assigned.
    is_overridden: bool = False
    is_skipped: bool = False


class CompletionCreate(BaseModel):
    member_id: uuid.UUID
    occurrence_date: date


class MoveToTodayRequest(BaseModel):
    # Re-anchors the chore's recurrence to today (its cadence re-phases from today).
    # If set, also records today's completion for this member (the Missed-row flow,
    # where the row is per-pending-member so we always have one).
    member_id: uuid.UUID | None = None


class CompletionOut(BaseModel):
    task_id: uuid.UUID
    member_id: uuid.UUID
    occurrence_date: date
    completed_at: datetime


class StreakOut(BaseModel):
    task_id: uuid.UUID
    member_id: uuid.UUID
    current_streak: int
    longest_streak: int


# ── Rotation overrides (swap / skip) ────────────────────────────────────────────


class RotationOverrideSet(BaseModel):
    # None == skip (excused; no one assigned). Otherwise the member who takes the turn.
    member_id: uuid.UUID | None = None
    # "occurrence" = just this date; "turn" = the whole rotation period it falls in.
    scope: Literal["occurrence", "turn"] = "occurrence"


class RotationOverrideOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    task_id: uuid.UUID
    occurrence_date: date
    member_id: uuid.UUID | None


# ── Chore balancer (auto day/who-starts planning) ───────────────────────────────


BalanceMode = Literal["rotate", "fixed", "keep"]


class BalanceItemIn(BaseModel):
    """How the balancer should treat one recurring chore.

    ``rotate`` — split between the chosen people; the optimizer picks the day and
    who starts. ``fixed`` — always ``fixed_member_id``; the optimizer still picks a
    good day. ``keep`` — leave the chore exactly as-is, but count its current load
    so the plan balances around it. ``minutes`` is the chore's time-to-do (the load
    weight); for a weekly chore ``lock_day`` keeps its current weekday.
    """

    task_id: uuid.UUID
    mode: BalanceMode = "rotate"
    minutes: int = Field(30, ge=1, le=1440)
    lock_day: bool = False
    fixed_member_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _check_fixed(self) -> "BalanceItemIn":
        if self.mode == "fixed" and self.fixed_member_id is None:
            raise ValueError("fixed_member_id is required when mode is 'fixed'")
        return self


class BalancePlanRequest(BaseModel):
    # The people to spread the load between, in roster order (≥ 1).
    member_ids: list[uuid.UUID] = Field(min_length=1)
    items: list[BalanceItemIn] = Field(min_length=1)
    # Weekdays chores may be placed on (0=Mon … 6=Sun). None / empty = all 7.
    allowed_weekdays: list[int] | None = None
    # Per-person target share of the load, aligned to member_ids; None = even split.
    shares: list[float] | None = None
    horizon_days: int = Field(28, ge=7, le=84)
    # Bumping the seed asks for a different (still balanced) layout — "regenerate".
    seed: int = Field(0, ge=0)

    @model_validator(mode="after")
    def _check(self) -> "BalancePlanRequest":
        if self.shares is not None and len(self.shares) != len(self.member_ids):
            raise ValueError("shares must align with member_ids")
        if self.allowed_weekdays is not None:
            for wd in self.allowed_weekdays:
                if not 0 <= wd <= 6:
                    raise ValueError("allowed_weekdays entries must be 0..6")
        return self


class BalanceChangeOut(BaseModel):
    """One chore's proposed new placement + assignment (the diff to apply)."""

    task_id: uuid.UUID
    title: str
    # Target task fields (what apply would write).
    rrule: str | None
    start_date: date
    assignment_strategy: AssignmentStrategy
    rotation_unit: RotationUnit
    rotation_interval: int
    rotation_anchor_date: date | None
    member_ids: list[uuid.UUID]
    # Display helpers for the preview.
    weekday: int | None = None  # placed weekday (single-day weekly chores), else None
    starter_id: uuid.UUID | None = None  # who takes the first horizon occurrence (rotate)
    summary: str  # e.g. "Tuesdays · Alex starts"


class BalancePersonOut(BaseModel):
    member_id: uuid.UUID
    name: str
    color: str
    before_per_week: float
    after_per_week: float


class BalancePreviewOut(BaseModel):
    people: list[BalancePersonOut]
    # 7 entries, Mon→Sun; each maps member_id (str) → average effort that weekday.
    weekday_loads: list[dict[str, float]]
    busiest_before: float  # the single heaviest (person, weekday) load, before
    busiest_after: float
    imbalance_before: float  # spread of per-person weekly totals, before
    imbalance_after: float


class BalancePlanOut(BaseModel):
    seed: int
    horizon_days: int
    changes: list[BalanceChangeOut]
    preview: BalancePreviewOut


class BalanceApplyOut(BaseModel):
    updated: int
