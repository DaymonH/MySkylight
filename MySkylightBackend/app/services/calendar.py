import re
import uuid
from datetime import date, datetime, timezone, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dateutil.rrule import rrulestr
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.base import utcnow
from app.models.calendar import Event, EventAssignment, EventException, Reminder
from app.models.external import ExternalAccount, ExternalCalendar, is_external_mirror
from app.models.family import Family, Member
from app.schemas.event import EventCreate, EventSource, EventUpdate, MemberBrief, OccurrenceOut


# ── Color resolution ──────────────────────────────────────────────────────────

# Fallback for a native event with no per-event color and no assigned member.
DEFAULT_EVENT_COLOR = "#f0603f"


def _resolve_color(event_color: str | None, member_colors: list[str], fallback: str) -> str:
    if event_color:
        return event_color
    if member_colors:
        return member_colors[0]
    return fallback


# ── Source / provenance ───────────────────────────────────────────────────────

# Shown for native events with no external calendar. Kept as a constant so the
# label is consistent everywhere occurrences are built.
LOCAL_SOURCE_LABEL = "MySkylight"


def _event_source(
    ext_cal: ExternalCalendar | None, account: ExternalAccount | None
) -> EventSource:
    """Describe where an event came from (native vs. which connected calendar)."""
    if ext_cal is None:
        return EventSource(kind="local", label=LOCAL_SOURCE_LABEL)
    return EventSource(
        kind="external",
        label=ext_cal.name,
        provider=account.provider.value if account else None,
        account_email=account.account_email if account else None,
    )


# ── Occurrence expansion ──────────────────────────────────────────────────────

def _utc(dt: datetime) -> datetime:
    """Attach UTC to a naive datetime (SQLite stores datetimes without tz)."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _resolve_tz(name: str | None) -> tzinfo:
    """Resolve a family's IANA timezone name, falling back to UTC if invalid."""
    if not name:
        return timezone.utc
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return timezone.utc


def _fmt_until(dt: datetime) -> str:
    """Format a datetime as an RRULE UTC UNTIL value (e.g. 20260109T140000Z)."""
    return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _truncate_rrule(rrule: str, until: datetime) -> str:
    """Return ``rrule`` bounded to end at ``until``.

    Any existing COUNT/UNTIL is dropped first: mixing COUNT and UNTIL is invalid
    per RFC 5545 and rejected by newer dateutil.
    """
    s = re.sub(r";?COUNT=\d+", "", rrule, flags=re.IGNORECASE)
    s = re.sub(r";?UNTIL=[^;]+", "", s, flags=re.IGNORECASE)
    s = s.strip(";")
    return f"{s};UNTIL={_fmt_until(until)}"


def _expand_event(
    event: Event,
    fallback_color: str,
    source: EventSource,
    from_dt: datetime,
    to_dt: datetime,
    tz: tzinfo,
) -> list[OccurrenceOut]:
    exc_map: dict[date, EventException] = {ex.original_date: ex for ex in event.exceptions}

    members = [
        MemberBrief(id=a.member.id, name=a.member.name, color=a.member.color)
        for a in event.assignments
        if getattr(a, "member", None) and not a.member.deleted_at
    ]
    member_colors = [m.color for m in members]
    reminder_minutes = [r.minutes_before for r in event.reminders]
    # Countdown "today" is the family-local date, matching the local occurrence
    # dates computed below (both default to UTC when no zone is set).
    today = datetime.now(tz).date()
    start_utc = _utc(event.start_dt)
    end_utc = _utc(event.end_dt)
    duration = end_utc - start_utc
    read_only = is_external_mirror(event.ical_uid)

    results: list[OccurrenceOut] = []

    def _emit(occ_date, start, end, title, description, location, is_exc, is_recurring):
        # Occurrences are computed in the family zone; emit UTC instants on the wire.
        results.append(OccurrenceOut(
            event_id=event.id,
            occurrence_date=occ_date,
            start_dt=start.astimezone(timezone.utc),
            end_dt=end.astimezone(timezone.utc),
            title=title,
            description=description,
            location=location,
            all_day=event.all_day,
            is_countdown=event.is_countdown,
            is_exception=is_exc,
            is_recurring=is_recurring,
            read_only=read_only,
            source=source,
            effective_color=_resolve_color(event.color, member_colors, fallback_color),
            members=members,
            reminder_minutes=reminder_minutes,
            days_until=(occ_date - today).days if event.is_countdown else None,
        ))

    if event.rrule:
        # Timed events expand in the family's local zone so a "9am weekly" series
        # stays at 9am local across DST instead of drifting with the UTC offset.
        # All-day events are *floating dates* (stored as midnight-UTC spans), so
        # expand them in UTC — converting to a negative-offset zone (e.g.
        # America/Denver) would shift each occurrence back a calendar day.
        base = start_utc if event.all_day else start_utc.astimezone(tz)
        rule = rrulestr(event.rrule, dtstart=base, ignoretz=False)
        # include occurrences whose start falls in [from_dt - duration, to_dt] so multi-day events aren't missed
        for occ_start in rule.between(from_dt - duration, to_dt, inc=True):
            occ_end = occ_start + duration
            if occ_end < from_dt:
                continue
            occ_date = occ_start.date()  # family-local calendar date
            exc = exc_map.get(occ_date)
            if exc and exc.is_cancelled:
                continue
            if exc:
                title = exc.title or event.title
                description = exc.description if exc.description is not None else event.description
                location = exc.location if exc.location is not None else event.location
                start = _utc(exc.start_dt) if exc.start_dt else occ_start
                end = _utc(exc.end_dt) if exc.end_dt else occ_end
                is_exc = True
            else:
                title, description, location = event.title, event.description, event.location
                start, end, is_exc = occ_start, occ_end, False
            _emit(occ_date, start, end, title, description, location, is_exc, True)
    else:
        if start_utc <= to_dt and end_utc >= from_dt:
            # All-day events are floating dates (midnight-UTC spans): take the date
            # as stored. Converting to the family zone would shift a negative-offset
            # zone back a day — e.g. an all-day "Jul 4" (00:00Z) would land on Jul 3.
            occ_date = start_utc.date() if event.all_day else start_utc.astimezone(tz).date()
            _emit(
                occ_date, start_utc, end_utc,
                event.title, event.description, event.location, False, False,
            )

    return results


# ── Eager-load options ────────────────────────────────────────────────────────

_EVENT_LOADS = [
    selectinload(Event.assignments).selectinload(EventAssignment.member),
    selectinload(Event.reminders),
    selectinload(Event.exceptions),
]


async def _reload_event(event_id: uuid.UUID, session: AsyncSession) -> Event:
    """Reload an event with its relationships fully refreshed.

    ``populate_existing`` forces the eager loaders to overwrite collections that
    are already cached in the session's identity map — without it, relationships
    mutated earlier in the same session (e.g. assignments/exceptions) would be
    returned stale.
    """
    result = await session.execute(
        select(Event)
        .where(Event.id == event_id)
        .options(*_EVENT_LOADS)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


# ── Event CRUD ────────────────────────────────────────────────────────────────

async def get_event(event_id: uuid.UUID, family_id: uuid.UUID, session: AsyncSession) -> Event | None:
    result = await session.execute(
        select(Event)
        .where(Event.id == event_id, Event.family_id == family_id, Event.deleted_at.is_(None))
        .options(*_EVENT_LOADS)
    )
    return result.scalar_one_or_none()


async def list_events(family_id: uuid.UUID, session: AsyncSession) -> list[Event]:
    result = await session.execute(
        select(Event)
        .where(Event.family_id == family_id, Event.deleted_at.is_(None))
        .options(*_EVENT_LOADS)
    )
    return list(result.scalars())


async def _validate_member_ids(
    family_id: uuid.UUID, member_ids: list[uuid.UUID], session: AsyncSession
) -> None:
    """Reject any member IDs that don't belong to ``family_id``.

    Without this, a caller could assign another family's Member to an event and
    leak that member (name/color) into this family's occurrence output.
    """
    if not member_ids:
        return
    result = await session.execute(
        select(Member.id).where(
            Member.id.in_(member_ids),
            Member.family_id == family_id,
            Member.deleted_at.is_(None),
        )
    )
    valid = {row[0] for row in result.all()}
    if any(mid not in valid for mid in member_ids):
        raise ValueError("One or more members do not belong to this family")


async def create_event(family_id: uuid.UUID, data: EventCreate, session: AsyncSession) -> Event:
    await _validate_member_ids(family_id, data.member_ids, session)

    event = Event(
        family_id=family_id,
        title=data.title,
        description=data.description,
        location=data.location,
        start_dt=data.start_dt,
        end_dt=data.end_dt,
        all_day=data.all_day,
        rrule=data.rrule,
        color=data.color,
        is_countdown=data.is_countdown,
    )
    session.add(event)
    await session.flush()

    for mid in data.member_ids:
        session.add(EventAssignment(event_id=event.id, member_id=mid))
    for mins in data.reminder_minutes:
        session.add(Reminder(event_id=event.id, minutes_before=mins))

    await session.commit()
    return await _reload_event(event.id, session)


_SCALAR_SKIP = {"edit_mode", "occurrence_date", "member_ids", "reminder_minutes"}


def _apply_event_fields(event: Event, data: EventUpdate) -> None:
    """Copy provided scalar fields from the patch onto the event."""
    for k, v in data.model_dump(exclude_none=True).items():
        if k not in _SCALAR_SKIP:
            setattr(event, k, v)


async def _replace_assignments(
    event: Event, member_ids: list[uuid.UUID] | None, session: AsyncSession
) -> None:
    if member_ids is None:
        return
    for a in list(event.assignments):
        await session.delete(a)
    await session.flush()
    for mid in member_ids:
        session.add(EventAssignment(event_id=event.id, member_id=mid))


async def _replace_reminders(
    event: Event, reminder_minutes: list[int] | None, session: AsyncSession
) -> None:
    if reminder_minutes is None:
        return
    for r in list(event.reminders):
        await session.delete(r)
    await session.flush()
    for mins in reminder_minutes:
        session.add(Reminder(event_id=event.id, minutes_before=mins))


async def update_event(event: Event, data: EventUpdate, session: AsyncSession) -> Event:
    mode = data.edit_mode

    # Family-scope anything the patch could repoint at another tenant's rows.
    if data.member_ids is not None:
        await _validate_member_ids(event.family_id, data.member_ids, session)

    if mode == "this" and data.occurrence_date:
        exc = next((e for e in event.exceptions if e.original_date == data.occurrence_date), None)
        if exc is None:
            exc = EventException(event_id=event.id, original_date=data.occurrence_date)
            session.add(exc)
        for field in ("title", "description", "location", "start_dt", "end_dt"):
            val = getattr(data, field)
            if val is not None:
                setattr(exc, field, val)
        await session.commit()

    elif mode == "following" and data.occurrence_date and event.rrule:
        # "This and following": truncate the original series just before the split
        # occurrence and spawn a new series that starts at it carrying the edits.
        original_rrule = event.rrule
        start_aware = _utc(event.start_dt)
        duration = _utc(event.end_dt) - start_aware
        # The split occurrence keeps the series' original time-of-day.
        occ_dt = datetime.combine(data.occurrence_date, start_aware.timetz())
        rule = rrulestr(original_rrule, dtstart=start_aware, ignoretz=False)
        prev = rule.before(occ_dt, inc=False)

        # Members/reminders to carry onto the new series (captured before mutation).
        copy_member_ids = (
            data.member_ids if data.member_ids is not None
            else [a.member_id for a in event.assignments]
        )
        copy_reminders = (
            data.reminder_minutes if data.reminder_minutes is not None
            else [r.minutes_before for r in event.reminders]
        )

        if prev is None:
            # Nothing precedes the split → editing every occurrence; fall through to "all".
            _apply_event_fields(event, data)
            await _replace_assignments(event, data.member_ids, session)
            await _replace_reminders(event, data.reminder_minutes, session)
            await session.commit()
            return await _reload_event(event.id, session)

        # Bound the original series to end at the last occurrence before the split.
        event.rrule = _truncate_rrule(original_rrule, prev)

        # Build the new series' rule, preserving any remaining COUNT.
        count_match = re.search(r"COUNT=(\d+)", original_rrule, flags=re.IGNORECASE)
        if count_match:
            consumed = sum(1 for o in rule if o < occ_dt)
            remaining = max(int(count_match.group(1)) - consumed, 1)
            new_rrule = re.sub(r"COUNT=\d+", f"COUNT={remaining}", original_rrule, flags=re.IGNORECASE)
        else:
            new_rrule = original_rrule

        simple = {k: v for k, v in data.model_dump(exclude_none=True).items()
                  if k not in ("edit_mode", "occurrence_date", "member_ids", "reminder_minutes")}
        new_start = simple.get("start_dt", occ_dt)
        new_end = simple.get("end_dt", new_start + duration)
        new_event = Event(
            family_id=event.family_id,
            external_calendar_id=event.external_calendar_id,
            title=simple.get("title", event.title),
            description=simple.get("description", event.description),
            location=simple.get("location", event.location),
            start_dt=new_start,
            end_dt=new_end,
            all_day=simple.get("all_day", event.all_day),
            rrule=simple.get("rrule", new_rrule),
            color=simple.get("color", event.color),
            is_countdown=simple.get("is_countdown", event.is_countdown),
        )
        session.add(new_event)
        await session.flush()

        for mid in copy_member_ids:
            session.add(EventAssignment(event_id=new_event.id, member_id=mid))
        for mins in copy_reminders:
            session.add(Reminder(event_id=new_event.id, minutes_before=mins))

        await session.commit()

    else:
        # Edit all occurrences
        _apply_event_fields(event, data)
        await _replace_assignments(event, data.member_ids, session)
        await _replace_reminders(event, data.reminder_minutes, session)
        await session.commit()

    return await _reload_event(event.id, session)


async def soft_delete_event(event: Event, session: AsyncSession) -> None:
    event.deleted_at = utcnow()
    await session.commit()


async def cancel_occurrence(event: Event, occ_date: date, session: AsyncSession) -> None:
    exc = next((e for e in event.exceptions if e.original_date == occ_date), None)
    if exc is None:
        exc = EventException(event_id=event.id, original_date=occ_date, is_cancelled=True)
        session.add(exc)
    else:
        exc.is_cancelled = True
    await session.commit()


# ── Occurrence expansion ──────────────────────────────────────────────────────

async def get_occurrences(
    family_id: uuid.UUID,
    from_dt: datetime,
    to_dt: datetime,
    session: AsyncSession,
) -> list[OccurrenceOut]:
    family = await session.get(Family, family_id)
    tz = _resolve_tz(family.timezone if family else None)
    # Native events (external_calendar_id IS NULL) always show; mirrored events show
    # only while their source calendar is toggled on (synced).
    query = (
        select(Event, ExternalCalendar)
        .outerjoin(ExternalCalendar, ExternalCalendar.id == Event.external_calendar_id)
        .where(
            Event.family_id == family_id,
            Event.deleted_at.is_(None),
            or_(Event.external_calendar_id.is_(None), ExternalCalendar.synced.is_(True)),
        )
        .options(*_EVENT_LOADS)
        .execution_options(populate_existing=True)
    )

    rows = (await session.execute(query)).all()

    # Batch-load the accounts behind any mirrored calendars so the per-event
    # source label can name the provider + connected account, without an async
    # lazy-load per row. Skipped entirely when nothing is mirrored (all native).
    account_ids = {ec.account_id for _, ec in rows if ec is not None}
    accounts: dict[uuid.UUID, ExternalAccount] = {}
    if account_ids:
        res = await session.execute(
            select(ExternalAccount).where(ExternalAccount.id.in_(account_ids))
        )
        accounts = {a.id: a for a in res.scalars()}

    occurrences: list[OccurrenceOut] = []
    for event, ext_cal in rows:
        fallback = (ext_cal.color if ext_cal else None) or DEFAULT_EVENT_COLOR
        source = _event_source(ext_cal, accounts.get(ext_cal.account_id) if ext_cal else None)
        occurrences.extend(_expand_event(event, fallback, source, from_dt, to_dt, tz))

    occurrences.sort(key=lambda o: o.start_dt)
    return occurrences
