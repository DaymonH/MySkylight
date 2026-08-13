"""External calendar accounts — Phase 7 (F18 Google, F20 Apple).

Read-only / one-way pull: the household connects an external account and its
calendars are *mirrored in* for display. We never write back. An
`ExternalAccount` holds the connection + OAuth/CalDAV credentials; each
`ExternalCalendar` is one calendar discovered on that account, mirrored in
read-only once the user toggles it on (`synced`). Its events are ordinary
`Event` rows whose `external_calendar_id` points back here.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin


class ExternalProvider(str, enum.Enum):
    google = "google"
    apple = "apple"
    # A subscribed iCalendar (`.ics`) feed URL (F25 revived as a subscription):
    # no auth, no incremental protocol — every pull re-fetches the whole feed and
    # reconciles. Used for read-only feeds like a public US-Holidays calendar.
    ics = "ics"


class ExternalAccountStatus(str, enum.Enum):
    active = "active"
    needs_reauth = "needs_reauth"  # token refresh failed / access revoked


# Events mirrored from an external provider are stored as ordinary `Event` rows
# whose `ical_uid` is namespaced by provider ("google:<cal>:<id>",
# "apple:<cal>:<href>", "ics:<feed-url>:<uid>") so re-syncs upsert the same row.
# These prefixes are the read-only marker: an event carrying one is a mirror we
# must never let the app edit (a local edit would be silently clobbered on the
# next pull). F18/F20/F25.
EXTERNAL_MIRROR_UID_PREFIXES = ("google:", "apple:", "ics:")


def is_external_mirror(ical_uid: str | None) -> bool:
    """True if ``ical_uid`` marks an event mirrored read-only from a provider.

    Distinct from a plain `.ics`-import UID (F25), which is editable: those carry
    the feed's own UID and lack the provider prefix.
    """
    return bool(ical_uid) and ical_uid.startswith(EXTERNAL_MIRROR_UID_PREFIXES)


class ExternalAccount(Base, TimestampMixin, SoftDeleteMixin):
    """A household's connected external calendar account (read-only pull) — F18/F20.

    Tokens are stored as-is: this is a self-hosted, single-household deployment
    where the SQLite file is already the trust boundary. Encrypting tokens at rest
    is a noted follow-up, not done here.
    """

    __tablename__ = "external_accounts"
    __table_args__ = (UniqueConstraint("family_id", "provider", "account_email"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    family_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("families.id"), index=True)
    provider: Mapped[ExternalProvider] = mapped_column(
        Enum(ExternalProvider, name="external_provider")
    )
    # The connected account's email/identity, used to label it and to upsert on reconnect.
    account_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    access_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_expiry: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    scopes: Mapped[str | None] = mapped_column(Text, nullable=True)  # space-separated
    status: Mapped[ExternalAccountStatus] = mapped_column(
        Enum(ExternalAccountStatus, name="external_account_status"),
        default=ExternalAccountStatus.active,
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    family: Mapped["Family"] = relationship()  # noqa: F821
    calendars: Mapped[list["ExternalCalendar"]] = relationship(
        back_populates="account", cascade="all, delete-orphan"
    )


class ExternalCalendar(Base, TimestampMixin):
    """A calendar discovered on a connected account.

    `synced` is the integrations on/off toggle: while true, the pull engine mirrors
    this calendar's events read-only into the family (as `Event` rows whose
    `external_calendar_id` points back here) and advances `sync_token` for
    incremental fetches.
    """

    __tablename__ = "external_calendars"
    __table_args__ = (UniqueConstraint("account_id", "external_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("external_accounts.id"), index=True
    )
    family_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("families.id"), index=True)
    external_id: Mapped[str] = mapped_column(String(512))  # provider's calendar id
    name: Mapped[str] = mapped_column(String(512))
    color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    # On/off toggle for read-only mirroring (replaces the old calendar_id mapping).
    synced: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    sync_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    account: Mapped["ExternalAccount"] = relationship(back_populates="calendars")
