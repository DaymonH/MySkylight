"""Shared request-validation helpers."""

from datetime import date

from fastapi import HTTPException, Query

# Recurrence is expanded in Python, per request, into one object per occurrence.
# An unbounded `from`/`to` window lets a single request materialize an enormous
# set (a daily rule over a century = ~36k objects per series). Cap the span well
# above the widest legitimate view — the frontend's 365-day countdown strip — and
# reject anything larger rather than silently truncating.
MAX_OCCURRENCE_WINDOW_DAYS = 400


def occurrence_window(
    from_date: date = Query(..., alias="from"),
    to_date: date = Query(..., alias="to"),
) -> tuple[date, date]:
    """Validate a `?from=&to=` occurrence range and return it as `(from, to)`."""
    span = (to_date - from_date).days
    if span < 0:
        raise HTTPException(400, "'to' must be on or after 'from'")
    if span > MAX_OCCURRENCE_WINDOW_DAYS:
        raise HTTPException(
            400,
            f"Requested range of {span} days exceeds the maximum of "
            f"{MAX_OCCURRENCE_WINDOW_DAYS} days.",
        )
    return from_date, to_date
