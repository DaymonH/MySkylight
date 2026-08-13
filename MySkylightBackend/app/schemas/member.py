import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class MemberCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    color: str = Field(default="#6366f1", pattern=r"^#[0-9a-fA-F]{6}$")
    is_child: bool = False
    pin: str | None = Field(None, min_length=4, max_length=8, pattern=r"^\d+$")
    user_id: uuid.UUID | None = None


class MemberUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    color: str | None = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")
    avatar_url: str | None = None
    pin: str | None = Field(None, min_length=4, max_length=8, pattern=r"^\d+$")


class MemberOut(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    family_id: uuid.UUID
    user_id: uuid.UUID | None
    name: str
    color: str
    avatar_url: str | None
    is_child: bool
    created_at: datetime
