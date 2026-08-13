import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin


class AssignmentStrategy(str, enum.Enum):
    """How a task's assignee is chosen per occurrence (F27)."""

    fixed = "fixed"  # every assigned member is responsible each occurrence
    rotating = "rotating"  # one member per occurrence, cycling the ordered roster


class RotationUnit(str, enum.Enum):
    """Cadence the rotating assignee advances on — decoupled from recurrence (F27).

    The chore's ``rrule`` says *when it happens*; this says *how often the
    responsible person changes*. ``occurrence`` (the default) steps every Nth
    occurrence — reproducing the original per-occurrence behaviour — while the
    time units step on calendar boundaries (weeks on Monday, months on the 1st),
    so e.g. a *daily* chore can have a single *weekly* owner.
    """

    occurrence = "occurrence"
    day = "day"
    week = "week"
    month = "month"


class Routine(Base, TimestampMixin, SoftDeleteMixin):
    """An ordered group of tasks (e.g. "Morning", "Bedtime")."""

    __tablename__ = "routines"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    family_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("families.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    family: Mapped["Family"] = relationship()  # noqa: F821
    tasks: Mapped[list["Task"]] = relationship(back_populates="routine")


class Task(Base, TimestampMixin, SoftDeleteMixin):
    """A chore/habit. Optionally grouped in a routine and/or recurring.

    Recurrence is *date-based* (unlike timed calendar events): ``rrule`` is anchored
    at ``start_date``. With no ``rrule`` the task is a single dated to-do on
    ``start_date``. Completions are tracked per occurrence date in TaskCompletion.
    """

    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    family_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("families.id"), index=True)
    routine_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("routines.id"), index=True, nullable=True
    )
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    start_date: Mapped[date] = mapped_column(Date)
    rrule: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    assignment_strategy: Mapped[AssignmentStrategy] = mapped_column(
        Enum(AssignmentStrategy, name="assignment_strategy"),
        default=AssignmentStrategy.fixed,
    )
    # Rotation cadence (F27), independent of `rrule`. `occurrence`/1 == legacy
    # per-occurrence rotation. `rotation_anchor_date` is the phase origin for the
    # cycle (falls back to `start_date`); keeping it separate lets the rotation be
    # re-phased without disturbing recurrence.
    rotation_unit: Mapped[RotationUnit] = mapped_column(
        Enum(RotationUnit, name="rotation_unit"),
        default=RotationUnit.occurrence,
    )
    rotation_interval: Mapped[int] = mapped_column(Integer, default=1)
    rotation_anchor_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Stars granted to the member who completes an occurrence (F14 rewards).
    star_value: Mapped[int] = mapped_column(Integer, default=1)
    # Rough time-to-do in minutes (F30). Optional; the chore balancer uses it as the
    # per-chore load weight, and the task editor prompts for it.
    estimated_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    family: Mapped["Family"] = relationship()  # noqa: F821
    routine: Mapped["Routine | None"] = relationship(back_populates="tasks")
    assignments: Mapped[list["TaskAssignment"]] = relationship(
        back_populates="task", cascade="all, delete-orphan"
    )
    completions: Mapped[list["TaskCompletion"]] = relationship(
        back_populates="task", cascade="all, delete-orphan"
    )
    rotation_overrides: Mapped[list["TaskRotationOverride"]] = relationship(
        back_populates="task", cascade="all, delete-orphan"
    )


class TaskAssignment(Base, TimestampMixin):
    __tablename__ = "task_assignments"
    __table_args__ = (UniqueConstraint("task_id", "member_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id"), index=True)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id"), index=True)
    # Position in the rotation roster (F27). Ignored for fixed assignment.
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    task: Mapped["Task"] = relationship(back_populates="assignments")
    member: Mapped["Member"] = relationship()  # noqa: F821


class TaskRotationOverride(Base, TimestampMixin):
    """A manual reassignment of a single rotating-task occurrence (F27 swap/skip).

    Wins over the computed rotation for its ``occurrence_date``: ``member_id`` set
    reassigns the turn to that member (a *swap*); ``member_id`` NULL means *skip* —
    no one is on the hook for that occurrence ("not my week"). Clearing the override
    deletes the row, reverting to the computed assignee.
    """

    __tablename__ = "task_rotation_overrides"
    __table_args__ = (UniqueConstraint("task_id", "occurrence_date"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id"), index=True)
    occurrence_date: Mapped[date] = mapped_column(Date, index=True)
    # NULL == skip (excused; no assignee). Otherwise the member who takes this turn.
    member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id"), index=True, nullable=True
    )

    task: Mapped["Task"] = relationship(back_populates="rotation_overrides")


class TaskCompletion(Base, TimestampMixin):
    """One member checking off one task on one occurrence date (idempotent)."""

    __tablename__ = "task_completions"
    __table_args__ = (UniqueConstraint("task_id", "member_id", "occurrence_date"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id"), index=True)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id"), index=True)
    occurrence_date: Mapped[date] = mapped_column(Date, index=True)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Snapshot of the task's star_value at completion time (F14); earned-star math
    # sums this so later star_value edits don't rewrite history. Undo deletes the row.
    stars_awarded: Mapped[int] = mapped_column(Integer, default=0)

    task: Mapped["Task"] = relationship(back_populates="completions")
    member: Mapped["Member"] = relationship()  # noqa: F821
