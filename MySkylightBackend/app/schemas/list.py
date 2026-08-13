import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, model_validator

from app.models.list import ListType
from app.schemas.event import MemberBrief

# ── Lists ─────────────────────────────────────────────────────────────────────


class ListCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    list_type: ListType = ListType.todo
    sort_order: int = 0


class ListUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    list_type: ListType | None = None
    sort_order: int | None = None


class ListReorder(BaseModel):
    list_ids: list[uuid.UUID]


# ── Items ─────────────────────────────────────────────────────────────────────


class ListItemCreate(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    quantity: str | None = Field(None, max_length=50)
    category: str | None = Field(None, max_length=100)
    assignee_member_id: uuid.UUID | None = None
    sort_order: int = 0


class ListItemUpdate(BaseModel):
    text: str | None = Field(None, min_length=1, max_length=500)
    quantity: str | None = Field(None, max_length=50)
    category: str | None = Field(None, max_length=100)
    is_checked: bool | None = None
    assignee_member_id: uuid.UUID | None = None
    sort_order: int | None = None


class ItemReorder(BaseModel):
    item_ids: list[uuid.UUID]


# ── Output ────────────────────────────────────────────────────────────────────


class ListItemOut(BaseModel):
    id: uuid.UUID
    list_id: uuid.UUID
    text: str
    quantity: str | None
    category: str | None
    is_checked: bool
    checked_at: datetime | None
    sort_order: int
    assignee: MemberBrief | None
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="before")
    @classmethod
    def _from_orm(cls, v: Any) -> Any:
        if isinstance(v, dict):
            return v
        a = getattr(v, "assignee", None)
        assignee = (
            {"id": a.id, "name": a.name, "color": a.color}
            if a is not None and not getattr(a, "deleted_at", None)
            else None
        )
        return {
            "id": v.id,
            "list_id": v.list_id,
            "text": v.text,
            "quantity": v.quantity,
            "category": v.category,
            "is_checked": v.is_checked,
            "checked_at": v.checked_at,
            "sort_order": v.sort_order,
            "assignee": assignee,
            "created_at": v.created_at,
            "updated_at": v.updated_at,
        }


class ListOut(BaseModel):
    id: uuid.UUID
    family_id: uuid.UUID
    name: str
    list_type: ListType
    sort_order: int
    created_at: datetime
    updated_at: datetime
    items: list[ListItemOut] = []

    @model_validator(mode="before")
    @classmethod
    def _from_orm(cls, v: Any) -> Any:
        if isinstance(v, dict):
            return v
        items = [i for i in (getattr(v, "items", []) or []) if not getattr(i, "deleted_at", None)]
        items.sort(key=lambda i: (i.sort_order, i.created_at))
        return {
            "id": v.id,
            "family_id": v.family_id,
            "name": v.name,
            "list_type": v.list_type,
            "sort_order": v.sort_order,
            "created_at": v.created_at,
            "updated_at": v.updated_at,
            "items": items,
        }
