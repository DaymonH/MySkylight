import enum
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import Boolean, Enum, Float, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin


class MembershipRole(str, enum.Enum):
    owner = "owner"
    adult = "adult"
    child = "child"
    viewer = "viewer"


class InvitationStatus(str, enum.Enum):
    pending = "pending"
    accepted = "accepted"
    revoked = "revoked"


class Family(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "families"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255))
    # IANA timezone for the household. Recurring events are expanded in this zone
    # so wall-clock times survive DST. Defaults to US Mountain Time (DST-aware);
    # changeable per family in settings.
    timezone: Mapped[str] = mapped_column(String(64), default="America/Denver")
    lock_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    lock_pin_hash: Mapped[str | None] = mapped_column(String(255))
    # Saved "home" location for the weather forecast. Set once in family settings so
    # the wall display and every device read the forecast from here instead of
    # prompting for browser geolocation on each app open. NULL until configured.
    weather_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    weather_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    weather_label: Mapped[str | None] = mapped_column(String(120), nullable=True)

    memberships: Mapped[list["Membership"]] = relationship(back_populates="family")
    members: Mapped[list["Member"]] = relationship(back_populates="family")
    invitations: Mapped[list["Invitation"]] = relationship(back_populates="family")


class Membership(Base, TimestampMixin):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("user_id", "family_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    family_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("families.id"))
    role: Mapped[MembershipRole] = mapped_column(
        Enum(MembershipRole, name="membership_role"), default=MembershipRole.adult
    )

    user: Mapped["User"] = relationship(back_populates="memberships")  # noqa: F821
    family: Mapped["Family"] = relationship(back_populates="memberships")


class Member(Base, TimestampMixin, SoftDeleteMixin):
    """A calendar persona within a family. May or may not have a User login."""

    __tablename__ = "members"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Indexed: `family_id` is filtered on nearly every hot read (occurrences, chores,
    # rewards, member validation); `user_id` backs ensure_member_for_user's lookup.
    # SQLite does not auto-index FKs, so these must be declared (see migration 016).
    family_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("families.id"), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(100))
    color: Mapped[str] = mapped_column(String(7), default="#6366f1")  # hex
    avatar_url: Mapped[str | None] = mapped_column(String(2048))
    pin_hash: Mapped[str | None] = mapped_column(String(255))  # child PIN
    is_child: Mapped[bool] = mapped_column(Boolean, default=False)

    family: Mapped["Family"] = relationship(back_populates="members")
    user: Mapped["User | None"] = relationship(back_populates="members")  # noqa: F821


class Invitation(Base, TimestampMixin):
    __tablename__ = "invitations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    family_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("families.id"))
    invited_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    # Optional: link this invite to an existing, login-less Member so that on accept
    # we claim that persona (preserving its chore assignments) instead of spawning a
    # fresh duplicate. NULL = create a brand-new persona on accept (the default).
    member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id"), nullable=True
    )
    email: Mapped[str] = mapped_column(String(255), index=True)
    role: Mapped[MembershipRole] = mapped_column(
        Enum(MembershipRole, name="invitation_role"), default=MembershipRole.adult
    )
    token: Mapped[str] = mapped_column(
        String(64), unique=True, default=lambda: secrets.token_urlsafe(32)
    )
    status: Mapped[InvitationStatus] = mapped_column(
        Enum(InvitationStatus, name="invitation_status"), default=InvitationStatus.pending
    )
    expires_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc) + timedelta(days=7)
    )

    family: Mapped["Family"] = relationship(back_populates="invitations")
    invited_by: Mapped["User"] = relationship()  # noqa: F821
    member: Mapped["Member | None"] = relationship()
