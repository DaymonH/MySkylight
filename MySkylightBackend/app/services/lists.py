import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.base import utcnow
from app.models.family import Member
from app.models.list import List, ListItem
from app.schemas.list import ListCreate, ListItemCreate, ListItemUpdate, ListUpdate

# ── Eager-load options ────────────────────────────────────────────────────────

_LIST_LOADS = [selectinload(List.items).selectinload(ListItem.assignee)]


async def _reload_list(list_id: uuid.UUID, session: AsyncSession) -> List:
    result = await session.execute(
        select(List)
        .where(List.id == list_id)
        .options(*_LIST_LOADS)
        # Refresh cached collections after a write in the same session (CLAUDE.md gotcha).
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def _reload_item(item_id: uuid.UUID, session: AsyncSession) -> ListItem:
    result = await session.execute(
        select(ListItem)
        .where(ListItem.id == item_id)
        .options(selectinload(ListItem.assignee))
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


# ── List CRUD ─────────────────────────────────────────────────────────────────


async def list_lists(family_id: uuid.UUID, session: AsyncSession) -> list[List]:
    result = await session.execute(
        select(List)
        .where(List.family_id == family_id, List.deleted_at.is_(None))
        .options(*_LIST_LOADS)
        .order_by(List.sort_order, List.name)
        .execution_options(populate_existing=True)
    )
    return list(result.scalars())


async def get_list(
    list_id: uuid.UUID, family_id: uuid.UUID, session: AsyncSession
) -> List | None:
    result = await session.execute(
        select(List)
        .where(List.id == list_id, List.family_id == family_id, List.deleted_at.is_(None))
        .options(*_LIST_LOADS)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def create_list(family_id: uuid.UUID, data: ListCreate, session: AsyncSession) -> List:
    lst = List(
        family_id=family_id,
        name=data.name,
        list_type=data.list_type,
        sort_order=data.sort_order,
    )
    session.add(lst)
    await session.commit()
    return await _reload_list(lst.id, session)


async def update_list(lst: List, data: ListUpdate, session: AsyncSession) -> List:
    fields = data.model_dump(exclude_unset=True)
    for k in ("name", "list_type", "sort_order"):
        if k in fields and fields[k] is not None:
            setattr(lst, k, fields[k])
    await session.commit()
    return await _reload_list(lst.id, session)


async def soft_delete_list(lst: List, session: AsyncSession) -> None:
    lst.deleted_at = utcnow()
    await session.commit()


async def reorder_lists(
    family_id: uuid.UUID, list_ids: list[uuid.UUID], session: AsyncSession
) -> None:
    """Set each list's sort_order to its index in ``list_ids``. Unknown ids are ignored."""
    result = await session.execute(
        select(List).where(List.family_id == family_id, List.deleted_at.is_(None))
    )
    by_id = {lst.id: lst for lst in result.scalars()}
    for idx, lid in enumerate(list_ids):
        if lid in by_id:
            by_id[lid].sort_order = idx
    await session.commit()


# ── Item CRUD ─────────────────────────────────────────────────────────────────


async def _validate_assignee(
    member_id: uuid.UUID | None, family_id: uuid.UUID, session: AsyncSession
) -> None:
    if member_id is None:
        return
    result = await session.execute(
        select(Member.id).where(
            Member.id == member_id,
            Member.family_id == family_id,
            Member.deleted_at.is_(None),
        )
    )
    if result.scalar_one_or_none() is None:
        raise ValueError("Assignee is not a member of this family")


async def _next_item_sort_order(list_id: uuid.UUID, session: AsyncSession) -> int:
    result = await session.execute(
        select(ListItem.sort_order).where(
            ListItem.list_id == list_id, ListItem.deleted_at.is_(None)
        )
    )
    orders = list(result.scalars())
    return (max(orders) + 1) if orders else 0


async def get_item(
    item_id: uuid.UUID, list_id: uuid.UUID, session: AsyncSession
) -> ListItem | None:
    result = await session.execute(
        select(ListItem)
        .where(
            ListItem.id == item_id,
            ListItem.list_id == list_id,
            ListItem.deleted_at.is_(None),
        )
        .options(selectinload(ListItem.assignee))
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def add_item(
    lst: List, data: ListItemCreate, family_id: uuid.UUID, session: AsyncSession
) -> ListItem:
    await _validate_assignee(data.assignee_member_id, family_id, session)
    # sort_order 0 (the default) means "append to the end".
    sort_order = data.sort_order or await _next_item_sort_order(lst.id, session)
    item = ListItem(
        list_id=lst.id,
        text=data.text,
        quantity=data.quantity,
        category=data.category,
        assignee_member_id=data.assignee_member_id,
        sort_order=sort_order,
    )
    session.add(item)
    await session.commit()
    return await _reload_item(item.id, session)


async def update_item(
    item: ListItem, data: ListItemUpdate, family_id: uuid.UUID, session: AsyncSession
) -> ListItem:
    fields = data.model_dump(exclude_unset=True)
    if "assignee_member_id" in fields:
        await _validate_assignee(fields["assignee_member_id"], family_id, session)
        item.assignee_member_id = fields["assignee_member_id"]
    # Nullable columns accept an explicit None (clear quantity/category).
    for k in ("quantity", "category"):
        if k in fields:
            setattr(item, k, fields[k])
    for k in ("text", "sort_order"):
        if k in fields and fields[k] is not None:
            setattr(item, k, fields[k])
    if fields.get("is_checked") is not None:
        item.is_checked = fields["is_checked"]
        item.checked_at = utcnow() if fields["is_checked"] else None
    await session.commit()
    return await _reload_item(item.id, session)


async def soft_delete_item(item: ListItem, session: AsyncSession) -> None:
    item.deleted_at = utcnow()
    await session.commit()


async def reorder_items(
    lst: List, item_ids: list[uuid.UUID], session: AsyncSession
) -> None:
    """Set each item's sort_order to its index in ``item_ids``. Unknown ids are ignored."""
    result = await session.execute(
        select(ListItem).where(ListItem.list_id == lst.id, ListItem.deleted_at.is_(None))
    )
    by_id = {item.id: item for item in result.scalars()}
    for idx, iid in enumerate(item_ids):
        if iid in by_id:
            by_id[iid].sort_order = idx
    await session.commit()
