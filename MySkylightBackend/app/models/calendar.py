import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin


class Event(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Source external calendar when this event is a read-only mirror (F18/F20);
    # NULL for native family events. Replaces the former local-Calendar container.
    external_calendar_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("external_calendars.id"), nullable=True, index=True
    )
    family_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("families.id"), index=True)
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    location: Mapped[str | None] = mapped_column(String(500), nullable=True)
    start_dt: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_dt: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    rrule: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    is_countdown: Mapped[bool] = mapped_column(Boolean, default=False)
    # External iCalendar UID for events imported from / exported to a `.ics` feed
    # (F25). Lets a re-import dedupe against the same source event instead of
    # duplicating it, and gives exports a stable UID. NULL for app-native events.
    ical_uid: Mapped[str | None] = mapped_column(String(500), nullable=True, index=True)

    family: Mapped["Family"] = relationship()  # noqa: F821
    assignments: Mapped[list["EventAssignment"]] = relationship(
        back_populates="event", cascade="all, delete-orphan"
    )
    reminders: Mapped[list["Reminder"]] = relationship(
        back_populates="event", cascade="all, delete-orphan"
    )
    exceptions: Mapped[list["EventException"]] = relationship(
        back_populates="event", cascade="all, delete-orphan"
    )


class EventException(Base, TimestampMixin):
    """Override or cancellation for a single occurrence of a recurring event."""

    __tablename__ = "event_exceptions"
    __table_args__ = (UniqueConstraint("event_id", "original_date"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id"), index=True)
    original_date: Mapped[date] = mapped_column(Date)
    is_cancelled: Mapped[bool] = mapped_column(Boolean, default=False)
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    location: Mapped[str | None] = mapped_column(String(500), nullable=True)
    start_dt: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_dt: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    event: Mapped["Event"] = relationship(back_populates="exceptions")


class EventAssignment(Base, TimestampMixin):
    __tablename__ = "event_assignments"
    __table_args__ = (UniqueConstraint("event_id", "member_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id"), index=True)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id"), index=True)

    event: Mapped["Event"] = relationship(back_populates="assignments")
    member: Mapped["Member"] = relationship()  # noqa: F821


class Reminder(Base, TimestampMixin):
    __tablename__ = "reminders"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id"), index=True)
    minutes_before: Mapped[int] = mapped_column(Integer, default=15)

    event: Mapped["Event"] = relationship(back_populates="reminders")
