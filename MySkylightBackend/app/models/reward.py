import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin


class RedemptionStatus(str, enum.Enum):
    pending = "pending"  # requested, awaiting a parent's decision (stars reserved)
    approved = "approved"  # granted (stars spent)
    rejected = "rejected"  # denied (stars released)


class Reward(Base, TimestampMixin, SoftDeleteMixin):
    """A catalog item a member can redeem stars for (F14)."""

    __tablename__ = "rewards"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    family_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("families.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    star_cost: Mapped[int] = mapped_column(Integer)
    icon: Mapped[str | None] = mapped_column(String(16), nullable=True)  # emoji
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    family: Mapped["Family"] = relationship()  # noqa: F821


class Redemption(Base, TimestampMixin):
    """A member's request to spend stars on a reward; parent-approved (F14).

    ``star_cost`` is snapshotted at request time so editing the reward later doesn't
    change in-flight or historical redemptions.
    """

    __tablename__ = "redemptions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    family_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("families.id"), index=True)
    reward_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rewards.id"), index=True)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id"), index=True)
    star_cost: Mapped[int] = mapped_column(Integer)
    status: Mapped[RedemptionStatus] = mapped_column(
        Enum(RedemptionStatus, name="redemption_status"), default=RedemptionStatus.pending
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    reward: Mapped["Reward"] = relationship()
    member: Mapped["Member"] = relationship()  # noqa: F821
