"""Subscribed iCalendar (`.ics`) feed fetching (F25, revived as a subscription).

A subscribed feed is just an HTTP(S) URL serving VCALENDAR text — a public
US-Holidays calendar, a school/sports feed, a Cozi export, etc. There's no auth
and no incremental protocol: every pull re-fetches the whole document, so the
mirror engine treats each pull as a full snapshot and reconciles against it.

This module only does the network fetch + light feed metadata; the returned text
is handed to `app.services.ics.parse_ics` (the same VEVENT mapper Apple/CalDAV
uses) and then to `external_sync.apply_mirror_events`.
"""

import httpx
from icalendar import Calendar as ICalendar

# Feeds are usually small (a year or two of events), but a big school/holiday feed
# on a slow uplink can take a moment — give the read room while keeping the connect
# request well under the frontend proxy's request budget.
_HTTP_TIMEOUT = httpx.Timeout(10.0, read=20.0)
# Don't try to parse a multi-megabyte response as a calendar (a mispointed URL
# returning a huge HTML page, say) — fail fast instead.
_MAX_BYTES = 10 * 1024 * 1024


class IcsFeedError(Exception):
    """The feed URL couldn't be fetched (network error, non-200, or too large)."""


def normalize_feed_url(url: str) -> str:
    """Canonicalise a subscription URL so it's fetchable and a stable mirror key.

    Calendar apps hand out ``webcal://`` (and ``webcals://``) links — the same
    resource over HTTP(S). Rewrite them so httpx can fetch and so the same feed
    always produces the same stored URL (and thus the same event uids on re-sync).
    """
    u = url.strip()
    if u.lower().startswith("webcals://"):
        return "https://" + u[len("webcals://") :]
    if u.lower().startswith("webcal://"):
        return "https://" + u[len("webcal://") :]
    return u


async def fetch_feed(url: str) -> str:
    """GET a feed URL and return its VCALENDAR text. Raises `IcsFeedError` on any
    network failure, a non-2xx status, or an implausibly large body."""
    target = normalize_feed_url(url)
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT, follow_redirects=True) as http:
            resp = await http.get(target, headers={"Accept": "text/calendar, */*"})
    except httpx.HTTPError as exc:
        raise IcsFeedError(f"Could not reach feed: {exc}") from exc
    if resp.status_code != 200:
        raise IcsFeedError(f"Feed returned HTTP {resp.status_code}")
    if len(resp.content) > _MAX_BYTES:
        raise IcsFeedError("Feed response too large")
    return resp.text


def feed_name(ics_text: str) -> str | None:
    """The feed's own display name (``X-WR-CALNAME``), if it advertises one — used
    as the default calendar name when the caller didn't supply one. Returns None
    if the text isn't a parseable calendar or carries no name."""
    try:
        cal = ICalendar.from_ical(ics_text)
    except (ValueError, KeyError):
        return None
    name = cal.get("X-WR-CALNAME")
    return str(name).strip() if name else None
