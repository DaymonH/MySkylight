import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.external import is_external_mirror


class MemberBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    color: str


class EventSource(BaseModel):
    """Where an event came from — so the UI can tell a locally-created event apart
    from one mirrored in read-only from a connected calendar.

    The "same" real-world event often exists in several connected places at once
    (typed into MySkylight *and* on a Google calendar *and* a shared iCloud one);
    each is a separate `Event` row with no cross-source dedup, so they all render.
    This label is how a user explains why an event appears more than once.
    """

    kind: Literal["local", "external"]
    # "MySkylight" for native events; the external calendar's name for mirrors.
    label: str
    # Mirror provider. "ics" = a subscribed feed (F25); must stay in sync with
    # ExternalProvider — a missing value here fails OccurrenceOut validation and
    # 500s the whole /occurrences request (one mirror event blanks the calendar).
    provider: Literal["google", "apple", "ics"] | None = None
    account_email: str | None = None


class EventCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    description: str | None = None
    location: str | None = None
    start_dt: datetime
    end_dt: datetime
    all_day: bool = False
    rrule: str | None = None
    color: str | None = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")
    is_countdown: bool = False
    member_ids: list[uuid.UUID] = []
    reminder_minutes: list[Annotated[int, Field(ge=0)]] = []

    @model_validator(mode="after")
    def _end_after_start(self) -> "EventCreate":
        if self.end_dt < self.start_dt:
            raise ValueError("end_dt must be on or after start_dt")
        return self


class EventUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=500)
    description: str | None = None
    location: str | None = None
    start_dt: datetime | None = None
    end_dt: datetime | None = None
    all_day: bool | None = None
    rrule: str | None = None
    color: str | None = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")
    is_countdown: bool | None = None
    member_ids: list[uuid.UUID] | None = None
    reminder_minutes: list[Annotated[int, Field(ge=0)]] | None = None
    edit_mode: Literal["this", "following", "all"] = "all"
    occurrence_date: date | None = None

    @model_validator(mode="after")
    def _end_after_start(self) -> "EventUpdate":
        if (
            self.start_dt is not None
            and self.end_dt is not None
            and self.end_dt < self.start_dt
        ):
            raise ValueError("end_dt must be on or after start_dt")
        return self


class EventOut(BaseModel):
    id: uuid.UUID
    external_calendar_id: uuid.UUID | None
    family_id: uuid.UUID
    title: str
    description: str | None
    location: str | None
    start_dt: datetime
    end_dt: datetime
    all_day: bool
    rrule: str | None
    color: str | None
    is_countdown: bool
    # True when this event is a read-only mirror of an external calendar (F18/F20).
    read_only: bool = False
    created_at: datetime
    updated_at: datetime
    members: list[MemberBrief] = []
    reminder_minutes: list[int] = []

    @model_validator(mode="before")
    @classmethod
    def _from_orm(cls, v: Any) -> Any:
        if isinstance(v, dict):
            return v
        assignments = getattr(v, "assignments", []) or []
        reminders = getattr(v, "reminders", []) or []
        return {
            "id": v.id,
            "external_calendar_id": getattr(v, "external_calendar_id", None),
            "family_id": v.family_id,
            "title": v.title,
            "description": v.description,
            "location": v.location,
            "start_dt": v.start_dt,
            "end_dt": v.end_dt,
            "all_day": v.all_day,
            "rrule": v.rrule,
            "color": v.color,
            "is_countdown": v.is_countdown,
            "read_only": is_external_mirror(getattr(v, "ical_uid", None)),
            "created_at": v.created_at,
            "updated_at": v.updated_at,
            "members": [
                {"id": a.member.id, "name": a.member.name, "color": a.member.color}
                for a in assignments
                if getattr(a, "member", None) and not a.member.deleted_at
            ],
            "reminder_minutes": [r.minutes_before for r in reminders],
        }


class OccurrenceOut(BaseModel):
    """A single expanded occurrence of an event (may be from a recurring series)."""

    event_id: uuid.UUID
    occurrence_date: date
    start_dt: datetime
    end_dt: datetime
    title: str
    description: str | None
    location: str | None
    all_day: bool
    is_countdown: bool
    is_exception: bool
    is_recurring: bool
    # True when the underlying event is a read-only external mirror (F18/F20):
    # the client shows it but must not offer edit/delete.
    read_only: bool
    # Provenance of the underlying event (local vs which synced calendar) — lets
    # the UI explain why the "same" event can appear more than once.
    source: EventSource
    effective_color: str
    members: list[MemberBrief]
    reminder_minutes: list[int]
    days_until: int | None
