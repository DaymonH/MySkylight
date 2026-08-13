"""iCalendar (`.ics`) parsing for read-only external sync.

The CalDAV / Apple path (F20) fetches a calendar's `.ics` payload and maps each
VEVENT onto a draft event via `parse_ics`: SUMMARY→title, DESCRIPTION, LOCATION,
DTSTART/DTEND, RRULE (stored verbatim as our bare ``FREQ=...`` string), and UID
(kept in `Event.ical_uid` so a re-sync dedupes against the same source event).

Deliberate simplifications: per-occurrence overrides (`RECURRENCE-ID`), EXDATE,
VALARM and attendees are **not** mapped — the master series imports, exceptions
are dropped. Everything is normalised to UTC; all-day `VALUE=DATE` events become
midnight-UTC spans with ``all_day=True``.
"""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from icalendar import Calendar as ICalendar

UTC = timezone.utc


@dataclass
class ParsedEvent:
    """A VEVENT flattened to the fields our `Event` model cares about."""

    title: str
    start_dt: datetime
    end_dt: datetime
    all_day: bool
    uid: str | None = None
    description: str | None = None
    location: str | None = None
    rrule: str | None = None


def _as_utc(dt: datetime) -> datetime:
    """Coerce any datetime to tz-aware UTC (naive → assumed UTC)."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def parse_ics(ics_text: str) -> list[ParsedEvent]:
    """Parse a VCALENDAR string into draft events. Malformed VEVENTs are skipped."""
    cal = ICalendar.from_ical(ics_text)
    parsed: list[ParsedEvent] = []

    for comp in cal.walk("VEVENT"):
        dtstart_prop = comp.get("dtstart")
        if dtstart_prop is None:
            continue  # a VEVENT without a start is unusable
        raw_start = dtstart_prop.dt
        dtend_prop = comp.get("dtend")
        raw_end = dtend_prop.dt if dtend_prop is not None else None

        # An all-day event has DATE (not DATETIME) values.
        all_day = isinstance(raw_start, date) and not isinstance(raw_start, datetime)
        if all_day:
            start_dt = datetime.combine(raw_start, time.min, tzinfo=UTC)
            end_date = raw_end if isinstance(raw_end, date) else raw_start + timedelta(days=1)
            end_dt = datetime.combine(end_date, time.min, tzinfo=UTC)
        else:
            start_dt = _as_utc(raw_start)
            # Missing DTEND → a zero-length event (RFC allows DURATION too; we keep it simple).
            end_dt = _as_utc(raw_end) if isinstance(raw_end, datetime) else start_dt

        rrule_prop = comp.get("rrule")
        rrule = rrule_prop.to_ical().decode("utf-8") if rrule_prop is not None else None

        uid = comp.get("uid")
        parsed.append(
            ParsedEvent(
                title=str(comp.get("summary") or "(untitled)"),
                start_dt=start_dt,
                end_dt=end_dt,
                all_day=all_day,
                uid=str(uid) if uid is not None else None,
                description=str(comp.get("description")) if comp.get("description") else None,
                location=str(comp.get("location")) if comp.get("location") else None,
                rrule=rrule,
            )
        )

    return parsed
