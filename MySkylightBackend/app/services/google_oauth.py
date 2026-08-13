"""Google Calendar OAuth + read-only API client (F18).

Read-only, one-way pull: we request the `calendar.readonly` scope only and never
write back to Google. Credentials come from env (`settings.google_client_id` /
`google_client_secret`); with them unset the connect flow is disabled (callers
should check `settings.google_oauth_configured` and 503).

The OAuth `state` is a stateless, HMAC-signed token carrying the family id, so the
browser-driven `/callback` — which arrives without a Clerk JWT — can be tied back
to the family that started the flow without a server-side session table.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlencode

import httpx

from app.core.config import settings

AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo"
CALENDAR_LIST_ENDPOINT = "https://www.googleapis.com/calendar/v3/users/me/calendarList"
EVENTS_ENDPOINT = "https://www.googleapis.com/calendar/v3/calendars/{cal}/events"

# Initial full sync only pulls events from this far back (future is unbounded).
# Keeps the first pull bounded; subsequent syncs are incremental via syncToken.
_INITIAL_WINDOW = timedelta(days=30)
_MAX_PAGES = 25  # backstop against an unexpectedly huge calendar

# Read-only calendar access + identity (to label the connected account).
SCOPES = ["https://www.googleapis.com/auth/calendar.readonly", "openid", "email"]

_STATE_TTL = timedelta(minutes=15)


class GoogleOAuthError(Exception):
    """Google rejected a token exchange/refresh, or the flow is misconfigured."""


class GoogleAuthExpired(GoogleOAuthError):
    """A 401 from the API — the access token is dead and a refresh is required."""


class SyncTokenExpired(GoogleOAuthError):
    """A 410 from events.list — the stored syncToken is stale; do a full resync."""


@dataclass
class GoogleTokens:
    access_token: str
    refresh_token: str | None
    expires_in: int  # seconds
    scope: str

    @property
    def expiry(self) -> datetime:
        return datetime.now(timezone.utc) + timedelta(seconds=self.expires_in)


@dataclass
class DiscoveredCalendar:
    external_id: str
    name: str
    color: str | None


@dataclass
class GoogleEvent:
    """A Google Calendar event flattened to the fields our mirror cares about.

    `status == "cancelled"` events carry only the id (the rest is empty) — they
    signal a deletion to apply to the mirror. Recurring-event *instances*
    (``recurring_event_id`` set) are per-occurrence overrides we don't mirror yet;
    the master series carries the RRULE.
    """

    external_id: str
    status: str  # "confirmed" | "tentative" | "cancelled"
    ical_uid: str | None
    title: str
    description: str | None
    location: str | None
    start_dt: datetime | None
    end_dt: datetime | None
    all_day: bool
    rrule: str | None
    recurring_event_id: str | None


@dataclass
class EventsPage:
    events: list[GoogleEvent]
    next_sync_token: str | None
    # The `timeMin` used on a full pull (no syncToken); None on an incremental
    # pull. Lets the caller reconcile-by-absence only within the fetched window.
    time_min: datetime | None = None


# ── Signed OAuth state ─────────────────────────────────────────────────────────


def _b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64u_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _sign(body: str) -> str:
    return _b64u(hmac.new(settings.pin_pepper.encode(), body.encode(), hashlib.sha256).digest())


def sign_state(family_id: uuid.UUID, *, issued_at: datetime | None = None) -> str:
    """Opaque, tamper-evident `state` binding the OAuth round-trip to a family."""
    issued = issued_at or datetime.now(timezone.utc)
    payload = {
        "fid": str(family_id),
        "ts": int(issued.timestamp()),
        "nonce": _b64u(uuid.uuid4().bytes),
    }
    body = _b64u(json.dumps(payload, separators=(",", ":")).encode())
    return f"{body}.{_sign(body)}"


def verify_state(state: str) -> uuid.UUID:
    """Return the family id from a signed state, or raise GoogleOAuthError."""
    try:
        body, sig = state.split(".", 1)
    except ValueError:
        raise GoogleOAuthError("Malformed OAuth state")
    if not hmac.compare_digest(sig, _sign(body)):
        raise GoogleOAuthError("OAuth state signature mismatch")
    payload = json.loads(_b64u_decode(body))
    issued = datetime.fromtimestamp(payload["ts"], tz=timezone.utc)
    if datetime.now(timezone.utc) - issued > _STATE_TTL:
        raise GoogleOAuthError("OAuth state expired")
    return uuid.UUID(payload["fid"])


# ── OAuth flow ─────────────────────────────────────────────────────────────────


def build_authorize_url(state: str) -> str:
    if not settings.google_oauth_configured:
        raise GoogleOAuthError("Google OAuth is not configured")
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",  # ask for a refresh token
        "prompt": "consent",  # force a refresh token even on re-consent
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{AUTH_ENDPOINT}?{urlencode(params)}"


def _tokens_from_response(body: dict, *, fallback_refresh: str | None = None) -> GoogleTokens:
    return GoogleTokens(
        access_token=body["access_token"],
        # Google omits refresh_token on refresh responses — keep the existing one.
        refresh_token=body.get("refresh_token", fallback_refresh),
        expires_in=int(body.get("expires_in", 3600)),
        scope=body.get("scope", ""),
    )


async def exchange_code(code: str) -> GoogleTokens:
    """Exchange an authorization code for tokens (read-only access)."""
    if not settings.google_oauth_configured:
        raise GoogleOAuthError("Google OAuth is not configured")
    data = {
        "code": code,
        "client_id": settings.google_client_id,
        "client_secret": settings.google_client_secret,
        "redirect_uri": settings.google_redirect_uri,
        "grant_type": "authorization_code",
    }
    async with httpx.AsyncClient(timeout=10.0) as http:
        resp = await http.post(TOKEN_ENDPOINT, data=data)
    if resp.status_code != 200:
        raise GoogleOAuthError(f"Token exchange failed ({resp.status_code}): {resp.text}")
    return _tokens_from_response(resp.json())


async def refresh_access_token(refresh_token: str) -> GoogleTokens:
    """Mint a fresh access token from a stored refresh token."""
    if not settings.google_oauth_configured:
        raise GoogleOAuthError("Google OAuth is not configured")
    data = {
        "refresh_token": refresh_token,
        "client_id": settings.google_client_id,
        "client_secret": settings.google_client_secret,
        "grant_type": "refresh_token",
    }
    async with httpx.AsyncClient(timeout=10.0) as http:
        resp = await http.post(TOKEN_ENDPOINT, data=data)
    if resp.status_code != 200:
        raise GoogleOAuthError(f"Token refresh failed ({resp.status_code}): {resp.text}")
    return _tokens_from_response(resp.json(), fallback_refresh=refresh_token)


async def fetch_account_email(access_token: str) -> str | None:
    """Best-effort identity lookup to label the connected account."""
    async with httpx.AsyncClient(timeout=10.0) as http:
        resp = await http.get(
            USERINFO_ENDPOINT, headers={"Authorization": f"Bearer {access_token}"}
        )
    if resp.status_code != 200:
        return None
    return resp.json().get("email")


async def list_calendars(access_token: str) -> list[DiscoveredCalendar]:
    """List the calendars on the account (read-only) so the user can map them."""
    async with httpx.AsyncClient(timeout=10.0) as http:
        resp = await http.get(
            CALENDAR_LIST_ENDPOINT, headers={"Authorization": f"Bearer {access_token}"}
        )
    if resp.status_code != 200:
        raise GoogleOAuthError(f"Could not list calendars ({resp.status_code}): {resp.text}")
    return [
        DiscoveredCalendar(
            external_id=item["id"],
            name=item.get("summaryOverride") or item.get("summary") or item["id"],
            color=item.get("backgroundColor"),
        )
        for item in resp.json().get("items", [])
    ]


# ── Events (read-only pull) ─────────────────────────────────────────────────


def _to_utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def parse_event(item: dict) -> GoogleEvent:
    """Map one Google `events` resource onto our flattened `GoogleEvent`.

    All-day events use ``start.date`` (a bare date, DTEND exclusive); timed events
    use ``start.dateTime`` (ISO 8601 with offset). Everything is normalised to
    tz-aware UTC, matching how the model and the ICS importer store times.
    """
    status = item.get("status", "confirmed")
    start = item.get("start") or {}
    end = item.get("end") or {}
    all_day = "date" in start

    start_dt: datetime | None = None
    end_dt: datetime | None = None
    if all_day:
        if start.get("date"):
            start_dt = datetime.fromisoformat(start["date"]).replace(tzinfo=timezone.utc)
        if end.get("date"):
            end_dt = datetime.fromisoformat(end["date"]).replace(tzinfo=timezone.utc)
    else:
        if start.get("dateTime"):
            start_dt = _to_utc(datetime.fromisoformat(start["dateTime"]))
        if end.get("dateTime"):
            end_dt = _to_utc(datetime.fromisoformat(end["dateTime"]))

    # `recurrence` is a list of iCal lines (RRULE / EXDATE / RDATE). We keep the
    # bare RRULE body (our `rrule` column's form) and drop the rest — exceptions
    # aren't mirrored yet (same simplification as the ICS importer).
    rrule = None
    for line in item.get("recurrence") or []:
        if line.startswith("RRULE:"):
            rrule = line[len("RRULE:") :]
            break

    return GoogleEvent(
        external_id=item["id"],
        status=status,
        ical_uid=item.get("iCalUID"),
        title=item.get("summary") or "(untitled)",
        description=item.get("description"),
        location=item.get("location"),
        start_dt=start_dt,
        end_dt=end_dt,
        all_day=all_day,
        rrule=rrule,
        recurring_event_id=item.get("recurringEventId"),
    )


async def fetch_events(
    access_token: str,
    calendar_external_id: str,
    *,
    sync_token: str | None = None,
) -> EventsPage:
    """Pull events for one calendar (read-only), following pagination.

    With a ``sync_token`` this is an incremental pull (only changes since last
    time, including deletions as ``status=cancelled``); without one it's a full
    pull bounded to a recent past window. Returns the events plus the
    ``nextSyncToken`` to persist for the next incremental run.

    Raises ``SyncTokenExpired`` on a 410 (caller should retry with no token) and
    ``GoogleAuthExpired`` on a 401 (caller should refresh the access token).
    """
    url = EVENTS_ENDPOINT.format(cal=quote(calendar_external_id, safe=""))
    headers = {"Authorization": f"Bearer {access_token}"}
    events: list[GoogleEvent] = []
    next_sync_token: str | None = None
    page_token: str | None = None
    # Full pull (no syncToken) is bounded to a recent window; report it so the
    # caller reconciles deletions only within what this pull could have returned.
    time_min = None if sync_token else datetime.now(timezone.utc) - _INITIAL_WINDOW

    async with httpx.AsyncClient(timeout=15.0) as http:
        for _ in range(_MAX_PAGES):
            params: dict[str, str] = {
                "singleEvents": "false",  # mirror recurring masters (RRULE), not instances
                "showDeleted": "true",  # so incremental pulls see cancellations
                "maxResults": "250",
            }
            if sync_token:
                params["syncToken"] = sync_token
            else:
                # timeMin is only valid on the initial pull; Google remembers it
                # for the syncToken so later incremental pulls stay within window.
                params["timeMin"] = time_min.isoformat()
            if page_token:
                params["pageToken"] = page_token

            resp = await http.get(url, headers=headers, params=params)
            if resp.status_code == 410:
                raise SyncTokenExpired("syncToken expired — full resync required")
            if resp.status_code == 401:
                raise GoogleAuthExpired("access token rejected")
            if resp.status_code != 200:
                raise GoogleOAuthError(f"Could not list events ({resp.status_code}): {resp.text}")

            body = resp.json()
            events.extend(parse_event(item) for item in body.get("items", []))
            next_sync_token = body.get("nextSyncToken") or next_sync_token
            page_token = body.get("nextPageToken")
            if not page_token:
                break

    return EventsPage(events=events, next_sync_token=next_sync_token, time_min=time_min)
