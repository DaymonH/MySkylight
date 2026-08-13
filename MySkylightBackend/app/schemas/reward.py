import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.reward import RedemptionStatus
from app.schemas.event import MemberBrief

# ── Rewards ───────────────────────────────────────────────────────────────────


class RewardCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = None
    star_cost: int = Field(ge=1)
    icon: str | None = Field(None, max_length=16)
    sort_order: int = 0
    is_active: bool = True


class RewardUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = None
    star_cost: int | None = Field(None, ge=1)
    icon: str | None = Field(None, max_length=16)
    sort_order: int | None = None
    is_active: bool | None = None


class RewardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    family_id: uuid.UUID
    name: str
    description: str | None
    star_cost: int
    icon: str | None
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


# ── Redemptions ───────────────────────────────────────────────────────────────


class RedemptionCreate(BaseModel):
    member_id: uuid.UUID


class RewardBrief(BaseModel):
    id: uuid.UUID
    name: str
    icon: str | None


class RedemptionOut(BaseModel):
    id: uuid.UUID
    family_id: uuid.UUID
    reward_id: uuid.UUID
    member_id: uuid.UUID
    star_cost: int
    status: RedemptionStatus
    decided_at: datetime | None
    created_at: datetime
    member: MemberBrief | None
    reward: RewardBrief | None

    @model_validator(mode="before")
    @classmethod
    def _from_orm(cls, v: Any) -> Any:
        if isinstance(v, dict):
            return v
        m = getattr(v, "member", None)
        r = getattr(v, "reward", None)
        return {
            "id": v.id,
            "family_id": v.family_id,
            "reward_id": v.reward_id,
            "member_id": v.member_id,
            "star_cost": v.star_cost,
            "status": v.status,
            "decided_at": v.decided_at,
            "created_at": v.created_at,
            "member": {"id": m.id, "name": m.name, "color": m.color} if m else None,
            "reward": {"id": r.id, "name": r.name, "icon": r.icon} if r else None,
        }


# ── Star balances (computed, not stored) ──────────────────────────────────────


class StarBalanceOut(BaseModel):
    """A member's star ledger. ``available = earned - spent - pending``.

    Pending redemptions reserve stars so they can't be double-spent before a parent
    decides. Approving moves pending→spent (no net change); rejecting releases them.
    """

    member_id: uuid.UUID
    name: str
    color: str
    earned: int
    spent: int  # approved redemptions
    pending: int  # awaiting approval (reserved)
    available: int
