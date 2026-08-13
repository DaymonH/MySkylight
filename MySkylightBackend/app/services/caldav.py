"""Apple/iCloud calendar access over CalDAV (F20).

iCloud has no public OAuth calendar API, so this is plain **CalDAV** authenticated
with the user's Apple ID + an **app-specific password** (generated at
appleid.apple.com). Read-only: we only ever PROPFIND/REPORT, never PUT/DELETE.

The credential is long-lived (no token refresh), so it's stored on the
`ExternalAccount` and replayed on every request — see `external_sync` for how the
discovered calendars are mirrored into local ones (the same engine Google uses).

Flow:
1. `discover_calendars` — PROPFIND the principal → calendar-home-set → the
   collection list (filtered to ones that hold VEVENTs).
2. `fetch_events` — a WebDAV `sync-collection` REPORT (RFC 6578) lists the changed
   resource hrefs + a new sync-token: an empty token pulls everything, a stored one
   only the delta (including removals); a rejected token raises
   `CalDavSyncTokenError` for a full re-pull. **iCloud's sync report omits the event
   bodies** (it returns hrefs + etags only), so a follow-up `calendar-multiget`
   REPORT (RFC 4791 §7.9) fetches the `calendar-data` for the changed hrefs.

The returned `calendar-data` is just iCalendar text, so the existing ICS parser
(`app.services.ics`) maps it to events — no second VEVENT parser.
"""

import xml.etree.ElementTree as ET
from dataclasses import dataclass
from urllib.parse import urljoin

import httpx

from app.core.config import settings

DAV = "DAV:"
CALDAV = "urn:ietf:params:xml:ns:caldav"
APPLE = "http://apple.com/ns/ical/"


def _q(ns: str, tag: str) -> str:
    return f"{{{ns}}}{tag}"


class CalDavError(Exception):
    """A CalDAV request failed or returned something we can't use."""


class CalDavAuthError(CalDavError):
    """401 — the Apple ID / app-specific password was rejected."""


class CalDavSyncTokenError(CalDavError):
    """The server rejected our stored sync-token; do a full re-pull."""


@dataclass
class DiscoveredCalendar:
    external_id: str  # absolute URL of the calendar collection
    name: str
    color: str | None


@dataclass
class CalDavResource:
    href: str
    deleted: bool  # removed upstream (404 in the sync report)
    calendar_data: str | None  # raw VCALENDAR text; None when deleted


@dataclass
class CalDavPage:
    resources: list[CalDavResource]
    next_sync_token: str | None


_PRINCIPAL_BODY = (
    b'<?xml version="1.0" encoding="utf-8"?>'
    b'<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>'
)
_HOME_BODY = (
    b'<?xml version="1.0" encoding="utf-8"?>'
    b'<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
    b"<d:prop><c:calendar-home-set/></d:prop></d:propfind>"
)
_LIST_BODY = (
    b'<?xml version="1.0" encoding="utf-8"?>'
    b'<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"'
    b' xmlns:a="http://apple.com/ns/ical/"><d:prop>'
    b"<d:displayname/><d:resourcetype/><a:calendar-color/>"
    b"<c:supported-calendar-component-set/></d:prop></d:propfind>"
)
_SYNC_BODY = (
    '<?xml version="1.0" encoding="utf-8"?>'
    '<d:sync-collection xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
    "<d:sync-token>{token}</d:sync-token><d:sync-level>1</d:sync-level>"
    "<d:prop><d:getetag/><c:calendar-data/></d:prop></d:sync-collection>"
)
_MULTIGET_HEAD = (
    '<?xml version="1.0" encoding="utf-8"?>'
    '<c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
    "<d:prop><d:getetag/><c:calendar-data/></d:prop>"
)
_MULTIGET_TAIL = "</c:calendar-multiget>"
# Cap hrefs per multiget so each REPORT returns a small, fast response — a full
# initial pull of a big calendar in one shot times out on slow uplinks (e.g. a Pi).
_MULTIGET_BATCH = 30
# iCloud can be slow to assemble calendar-data; give reads room beyond the default.
_HTTP_TIMEOUT = httpx.Timeout(20.0, read=60.0)


def _xml_escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _raise_for_status(resp: httpx.Response, *, sync_token: str | None = None) -> None:
    if resp.status_code == 401:
        raise CalDavAuthError("CalDAV credentials rejected")
    if sync_token and resp.status_code in (403, 409, 412):
        raise CalDavSyncTokenError(f"sync-token rejected ({resp.status_code})")
    if resp.status_code not in (200, 207):
        raise CalDavError(f"CalDAV request failed ({resp.status_code})")


def _first_prop_href(root: ET.Element, prop_tag: str) -> str:
    """The <d:href> nested under the first occurrence of ``prop_tag``."""
    for prop in root.iter(prop_tag):
        href = prop.find(_q(DAV, "href"))
        if href is not None and href.text:
            return href.text.strip()
    raise CalDavError(f"CalDAV response missing {prop_tag}")


def _propstat_has_404(response: ET.Element) -> bool:
    for propstat in response.iter(_q(DAV, "propstat")):
        status = propstat.find(_q(DAV, "status"))
        if status is not None and "404" in (status.text or ""):
            return True
    return False


def parse_calendar_list(root: ET.Element, base_url: str) -> list[DiscoveredCalendar]:
    """Pull the VEVENT-capable calendar collections out of a PROPFIND multistatus."""
    calendars: list[DiscoveredCalendar] = []
    for response in root.iter(_q(DAV, "response")):
        href_el = response.find(_q(DAV, "href"))
        if href_el is None or not href_el.text:
            continue
        href = href_el.text.strip()

        is_calendar = False
        name: str | None = None
        color: str | None = None
        components: set[str] = set()
        for propstat in response.iter(_q(DAV, "propstat")):
            prop = propstat.find(_q(DAV, "prop"))
            if prop is None:
                continue
            rtype = prop.find(_q(DAV, "resourcetype"))
            if rtype is not None and rtype.find(_q(CALDAV, "calendar")) is not None:
                is_calendar = True
            dn = prop.find(_q(DAV, "displayname"))
            if dn is not None and dn.text:
                name = dn.text.strip()
            col = prop.find(_q(APPLE, "calendar-color"))
            if col is not None and col.text:
                color = col.text.strip()[:7]  # iCloud sends #RRGGBBAA; keep #RRGGBB
            ccs = prop.find(_q(CALDAV, "supported-calendar-component-set"))
            if ccs is not None:
                components.update(c.get("name") for c in ccs.findall(_q(CALDAV, "comp")))

        if not is_calendar:
            continue  # the home set itself, or address books
        if components and "VEVENT" not in components:
            continue  # reminders/tasks-only collection
        url = urljoin(base_url, href)
        calendars.append(DiscoveredCalendar(external_id=url, name=name or url, color=color))
    return calendars


def parse_sync_response(root: ET.Element) -> CalDavPage:
    """Map a sync-collection / calendar-query multistatus to resources + token."""
    resources: list[CalDavResource] = []
    for response in root.iter(_q(DAV, "response")):
        href_el = response.find(_q(DAV, "href"))
        if href_el is None or not href_el.text:
            continue
        href = href_el.text.strip()

        status_el = response.find(_q(DAV, "status"))
        removed = status_el is not None and "404" in (status_el.text or "")

        calendar_data = None
        for cd in response.iter(_q(CALDAV, "calendar-data")):
            if cd.text:
                calendar_data = cd.text
                break
        if not removed and calendar_data is None and _propstat_has_404(response):
            removed = True

        resources.append(CalDavResource(href=href, deleted=removed, calendar_data=calendar_data))

    token_el = root.find(_q(DAV, "sync-token"))
    next_token = token_el.text.strip() if token_el is not None and token_el.text else None
    return CalDavPage(resources=resources, next_sync_token=next_token)


async def _propfind(http: httpx.AsyncClient, url: str, body: bytes, depth: int) -> tuple[ET.Element, str]:
    resp = await http.request(
        "PROPFIND",
        url,
        content=body,
        headers={"Depth": str(depth), "Content-Type": "application/xml; charset=utf-8"},
    )
    _raise_for_status(resp)
    return ET.fromstring(resp.text), str(resp.url)


async def discover_calendars(
    username: str, password: str, *, base_url: str | None = None
) -> list[DiscoveredCalendar]:
    """Walk principal → calendar-home-set → calendar list for an iCloud account."""
    base = base_url or settings.apple_caldav_url
    async with httpx.AsyncClient(
        auth=(username, password), timeout=15.0, follow_redirects=True
    ) as http:
        root, url = await _propfind(http, base, _PRINCIPAL_BODY, 0)
        principal = urljoin(url, _first_prop_href(root, _q(DAV, "current-user-principal")))

        root, url = await _propfind(http, principal, _HOME_BODY, 0)
        home = urljoin(url, _first_prop_href(root, _q(CALDAV, "calendar-home-set")))

        root, url = await _propfind(http, home, _LIST_BODY, 1)
        return parse_calendar_list(root, home)


async def _multiget(
    http: httpx.AsyncClient, calendar_url: str, hrefs: list[str]
) -> dict[str, str]:
    """Fetch ``calendar-data`` for specific resource hrefs via calendar-multiget.

    Returns ``{href: calendar_data}`` for the resources the server returned a body
    for; an href the server drops (e.g. removed between the two requests) is simply
    absent. Batched so a large initial pull doesn't send one enormous REPORT.
    """
    bodies: dict[str, str] = {}
    for i in range(0, len(hrefs), _MULTIGET_BATCH):
        href_xml = "".join(
            f"<d:href>{_xml_escape(h)}</d:href>" for h in hrefs[i : i + _MULTIGET_BATCH]
        )
        body = (_MULTIGET_HEAD + href_xml + _MULTIGET_TAIL).encode()
        resp = await http.request(
            "REPORT",
            calendar_url,
            content=body,
            headers={"Depth": "1", "Content-Type": "application/xml; charset=utf-8"},
        )
        _raise_for_status(resp)
        parsed = parse_sync_response(ET.fromstring(resp.text))
        bodies.update({r.href: r.calendar_data for r in parsed.resources if r.calendar_data})
    return bodies


async def fetch_events(
    calendar_url: str, username: str, password: str, *, sync_token: str | None = None
) -> CalDavPage:
    """Pull a calendar's events via a sync-collection REPORT (read-only).

    An empty ``sync_token`` is a full pull; a stored one is incremental (deltas +
    removals). The sync report only lists changed hrefs — iCloud omits the event
    bodies — so a follow-up ``calendar-multiget`` fetches ``calendar-data`` for the
    live resources the report didn't already inline. Raises ``CalDavSyncTokenError``
    if the token is rejected (caller should retry with none) and ``CalDavAuthError``
    on a 401.
    """
    body = _SYNC_BODY.format(token=_xml_escape(sync_token or "")).encode()
    async with httpx.AsyncClient(
        auth=(username, password), timeout=_HTTP_TIMEOUT, follow_redirects=True
    ) as http:
        resp = await http.request(
            "REPORT",
            calendar_url,
            content=body,
            headers={"Depth": "1", "Content-Type": "application/xml; charset=utf-8"},
        )
        _raise_for_status(resp, sync_token=sync_token)
        page = parse_sync_response(ET.fromstring(resp.text))

        # iCloud's sync-collection returns hrefs + etags but no bodies — pull the
        # calendar-data for live resources it didn't inline via calendar-multiget.
        missing = [r for r in page.resources if not r.deleted and r.calendar_data is None]
        if missing:
            bodies = await _multiget(http, calendar_url, [r.href for r in missing])
            for r in missing:
                r.calendar_data = bodies.get(r.href)

    return page
