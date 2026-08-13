"""Shared Pydantic field types."""

from datetime import datetime, timezone
from typing import Annotated

from pydantic import PlainSerializer


def _as_utc_iso(dt: datetime) -> str:
    """Serialize a datetime as an ISO-8601 string with an explicit UTC offset.

    SQLite has no tz-aware datetime type, so SQLAlchemy hands back timestamps we
    wrote as UTC (via ``utcnow()``) as *naive* datetimes. Left alone, Pydantic
    emits those with no offset (``2026-07-02T14:30:00``), and a browser's
    ``new Date()`` reads a zone-less date-time as *local* — rendering the raw UTC
    clock in the wrong zone (the "Synced …" label was hours off). Assume UTC for
    naive values and always emit an explicit offset so clients localise correctly
    (mirrors what the occurrence-expansion path already does for event times).
    """
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


# A datetime that always serialises to JSON with an explicit UTC offset. Use for
# any backend-generated timestamp read back from SQLite (created_at, last_synced_at…).
UtcDatetime = Annotated[
    datetime, PlainSerializer(_as_utc_iso, return_type=str, when_used="json")
]
