"""Schemas for external calendar accounts (F18 Google, F20 Apple)."""

import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.external import ExternalAccountStatus, ExternalProvider
from app.schemas.types import UtcDatetime


class ExternalCalendarOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    external_id: str
    name: str
    color: str | None = None
    # Whether this calendar is actively mirrored in (the on/off toggle).
    synced: bool = False
    last_synced_at: UtcDatetime | None = None


class ExternalAccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    provider: ExternalProvider
    account_email: str | None = None
    status: ExternalAccountStatus
    last_synced_at: UtcDatetime | None = None
    created_at: UtcDatetime
    calendars: list[ExternalCalendarOut] = []


class AuthorizeUrlOut(BaseModel):
    """The Google consent URL the client should open to start the connect flow."""

    authorize_url: str


class ExternalCalendarUpdateIn(BaseModel):
    """Partial update of a discovered external calendar's mirror settings.

    Any omitted field is left unchanged. ``synced`` true → mirror this calendar's
    events into the family; false → stop (already-mirrored events are hidden;
    re-enabling re-pulls). ``color`` re-tints its events on the calendar (#RRGGBB);
    because mirror events resolve their color live from the calendar, the change
    takes effect immediately without re-syncing.
    """

    synced: bool | None = None
    color: str | None = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")


class ExternalSyncResult(BaseModel):
    """Outcome of a pull (manual or scheduled)."""

    account_id: uuid.UUID
    status: ExternalAccountStatus
    calendars_synced: int
    created: int
    updated: int
    deleted: int


class AppleConnectIn(BaseModel):
    """Apple/iCloud connect (F20): an Apple ID + an app-specific password
    (appleid.apple.com → Sign-In and Security → App-Specific Passwords)."""

    apple_id: str = Field(min_length=3)
    app_password: str = Field(min_length=1)


class IcsFeedConnectIn(BaseModel):
    """Subscribe to a read-only iCalendar (`.ics`) feed (F25).

    ``url`` is a public feed URL — e.g. a US-Holidays calendar. ``webcal://`` links
    (what Apple/Google hand out) are accepted and normalised to HTTPS. ``name``
    defaults to the feed's own ``X-WR-CALNAME`` when omitted; ``color`` is an
    optional ``#RRGGBB`` used to tint its events on the calendar.
    """

    url: str = Field(min_length=8)
    name: str | None = Field(None, max_length=512)
    color: str | None = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")

    @field_validator("url")
    @classmethod
    def _supported_scheme(cls, v: str) -> str:
        u = v.strip()
        if not u.lower().startswith(("http://", "https://", "webcal://", "webcals://")):
            raise ValueError("URL must be http(s):// or webcal://")
        return u
