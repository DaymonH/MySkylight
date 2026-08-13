"""Turn raw Gemini extractions into normalized drafts.

The hard part is dates: flyers omit the year, the time, and the timezone. The model returns
what it *saw* (raw strings + flags); here we resolve them against the family's timezone. Pure
functions — no network, no DB — so they're unit-tested directly.
"""

import re
from datetime import date, datetime, time, timedelta, timezone, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dateutil import parser as dateparser

from app.schemas.magic_import import (
    EventDraft,
    EventExtractionResult,
    IngredientDraft,
    RawEventExtraction,
    RawRecipe,
    RecipeDraft,
)

DEFAULT_EVENT_DURATION = timedelta(hours=1)


def _resolve_tz(name: str | None) -> tzinfo:
    """Resolve a family's IANA timezone name, falling back to UTC (mirrors calendar.py)."""
    if not name:
        return timezone.utc
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return timezone.utc


def _parse_date(text: str, anchor: date) -> date | None:
    """Parse a free-form date string, filling missing parts from ``anchor``."""
    default = datetime(anchor.year, anchor.month, anchor.day)
    try:
        return dateparser.parse(text, default=default, fuzzy=True).date()
    except (ValueError, OverflowError, TypeError):
        return None


def _parse_time(text: str | None) -> time | None:
    if not text:
        return None
    try:
        return dateparser.parse(text, fuzzy=True).time()
    except (ValueError, OverflowError, TypeError):
        return None


def _next_occurrence(d: date, today: date) -> date:
    """Re-anchor a year-less date to the next occurrence on or after today."""
    try:
        candidate = d.replace(year=today.year)
    except ValueError:  # e.g. Feb 29 in a non-leap year
        candidate = d.replace(year=today.year, day=28)
    if candidate < today:
        try:
            candidate = candidate.replace(year=today.year + 1)
        except ValueError:
            candidate = candidate.replace(year=today.year + 1, day=28)
    return candidate


def normalize_events(
    raw: RawEventExtraction, family_tz: str, now: datetime | None = None
) -> EventExtractionResult:
    tz = _resolve_tz(family_tz)
    now = now or datetime.now(tz)
    today = now.date()

    drafts: list[EventDraft] = []
    for ev in raw.events:
        if not ev.title or not ev.title.strip() or not ev.date_text:
            continue
        d = _parse_date(ev.date_text, today)
        if d is None:
            continue

        year_inferred = False
        if not ev.has_explicit_year:
            d = _next_occurrence(d, today)
            year_inferred = True

        start_time = _parse_time(ev.start_time_text) if ev.has_explicit_time else None
        if start_time is None:
            # No usable time → all-day event (start == end at local midnight is valid).
            start = datetime(d.year, d.month, d.day, tzinfo=tz)
            drafts.append(
                EventDraft(
                    title=ev.title.strip()[:500],
                    description=ev.description,
                    location=ev.location,
                    start_dt=start,
                    end_dt=start,
                    all_day=True,
                    is_countdown=ev.is_countdown,
                    year_inferred=year_inferred,
                    time_inferred=True,
                )
            )
            continue

        start = datetime(d.year, d.month, d.day, start_time.hour, start_time.minute, tzinfo=tz)
        end_time = _parse_time(ev.end_time_text)
        if end_time is not None:
            end = datetime(d.year, d.month, d.day, end_time.hour, end_time.minute, tzinfo=tz)
            if end < start:
                end = start + DEFAULT_EVENT_DURATION
        else:
            end = start + DEFAULT_EVENT_DURATION

        drafts.append(
            EventDraft(
                title=ev.title.strip()[:500],
                description=ev.description,
                location=ev.location,
                start_dt=start,
                end_dt=end,
                all_day=False,
                is_countdown=ev.is_countdown,
                year_inferred=year_inferred,
                time_inferred=False,
            )
        )

    return EventExtractionResult(events=drafts, confidence=raw.confidence, notes=raw.notes)


def _clamp_minutes(value: int | None) -> int | None:
    """Drop nonsensical durations (negative, or absurdly long > 24h)."""
    if value is None or value < 0 or value > 24 * 60:
        return None
    return value


def _clean_image_url(url: str | None) -> str | None:
    if not url:
        return None
    url = url.strip()
    if not url.startswith("https://") or len(url) > 1000:
        return None
    return url


# Leading "1." / "1)" / "Step 1:" / "1 -" / bullet markers — stripped so the UI numbers steps.
_STEP_MARKER = re.compile(r"^\s*(?:step\s*)?\d{1,2}\s*[-.):]\s+|^\s*[-•*]\s+", re.IGNORECASE)
# Inline numbered markers used to split a run-on line ("… water. 2. Add salt …").
_NUMBERED_SPLIT = re.compile(r"(?:(?<=\s)|^)\d{1,2}[.)]\s+")
# Sentence-boundary fallback: terminal punctuation + space + a capital/digit.
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9])")


def normalize_instructions(text: str | None) -> str | None:
    """Normalize free-form recipe instructions into one clean step per line.

    The model is asked for one step per line, but recipes (and OCR'd cards) often arrive as a
    single run-on paragraph with inline "1." / "2." markers. We split those out — falling back to
    sentence boundaries — and strip any leading numbering/bullet so the UI renders (and numbers)
    the steps itself. Returns None when there's nothing usable.
    """
    if not text or not text.strip():
        return None
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(lines) <= 1:
        single = lines[0] if lines else text.strip()
        numbered = [p.strip() for p in _NUMBERED_SPLIT.split(single) if p.strip()]
        if len(numbered) > 1:
            lines = numbered
        else:
            sentences = [s.strip() for s in _SENTENCE_SPLIT.split(single) if s.strip()]
            lines = sentences if len(sentences) > 1 else [single]
    steps = [s for s in (_STEP_MARKER.sub("", ln).strip() for ln in lines) if s]
    return "\n".join(steps) if steps else None


def raw_recipe_to_draft(raw: RawRecipe, source_url: str | None = None) -> RecipeDraft | None:
    """Map a raw recipe extraction to a draft, or None when nothing usable was found."""
    if not raw.found or not raw.name or not raw.name.strip():
        return None
    ingredients = [
        IngredientDraft(
            name=i.name.strip()[:200],
            quantity=i.quantity if (i.quantity is None or i.quantity >= 0) else None,
            unit=(i.unit.strip()[:50] if i.unit and i.unit.strip() else None),
            section=(i.section.strip()[:100] if i.section and i.section.strip() else None),
            sort_order=idx,
        )
        for idx, i in enumerate(raw.ingredients)
        if i.name and i.name.strip()
    ]
    tags = [t.strip() for t in (raw.tags or []) if t and t.strip()][:20]
    servings = raw.servings if (raw.servings is None or raw.servings >= 0) else None
    return RecipeDraft(
        name=raw.name.strip()[:200],
        description=raw.description,
        instructions=normalize_instructions(raw.instructions),
        image_url=_clean_image_url(raw.image_url),
        servings=servings,
        prep_minutes=_clamp_minutes(raw.prep_minutes),
        cook_minutes=_clamp_minutes(raw.cook_minutes),
        tags=tags,
        ingredients=ingredients,
        confidence=raw.confidence,
        source_url=source_url,
    )
