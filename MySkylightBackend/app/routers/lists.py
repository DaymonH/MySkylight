import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.deps import AnyFamilyMember, FamilyOwnerOrAdult, require_family_role
from app.models.family import Family, Membership, MembershipRole
from app.schemas.list import (
    ItemReorder,
    ListCreate,
    ListItemCreate,
    ListItemOut,
    ListItemUpdate,
    ListOut,
    ListReorder,
    ListUpdate,
)
from app.services import lists as svc
from app.services.realtime import bus

router = APIRouter(tags=["lists"])

# Children may add/check/edit items; viewers are read-only.
FamilyActor = Annotated[
    tuple[Family, Membership],
    Depends(require_family_role(MembershipRole.owner, MembershipRole.adult, MembershipRole.child)),
]


async def _get_list_or_404(
    family_id: uuid.UUID, list_id: uuid.UUID, session: AsyncSession
):
    lst = await svc.get_list(list_id, family_id, session)
    if not lst:
        raise HTTPException(404, "List not found")
    return lst


# ── Lists ─────────────────────────────────────────────────────────────────────


@router.get("/families/{family_id}/lists", response_model=list[ListOut])
async def list_lists(
    family_id: uuid.UUID,
    _auth: AnyFamilyMember,
    session: AsyncSession = Depends(get_session),
):
    lists = await svc.list_lists(family_id, session)
    return [ListOut.model_validate(lst) for lst in lists]


@router.post("/families/{family_id}/lists", response_model=ListOut, status_code=201)
async def create_list(
    family_id: uuid.UUID,
    data: ListCreate,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    lst = await svc.create_list(family_id, data, session)
    await bus.publish(str(family_id), "list.created", {"id": str(lst.id)})
    return ListOut.model_validate(lst)


# Declared before /lists/{list_id} so "reorder" isn't parsed as a list id.
@router.post("/families/{family_id}/lists/reorder", status_code=204)
async def reorder_lists(
    family_id: uuid.UUID,
    data: ListReorder,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    await svc.reorder_lists(family_id, data.list_ids, session)
    await bus.publish(str(family_id), "list.reordered", {})


@router.get("/families/{family_id}/lists/{list_id}", response_model=ListOut)
async def get_list(
    family_id: uuid.UUID,
    list_id: uuid.UUID,
    _auth: AnyFamilyMember,
    session: AsyncSession = Depends(get_session),
):
    lst = await _get_list_or_404(family_id, list_id, session)
    return ListOut.model_validate(lst)


@router.patch("/families/{family_id}/lists/{list_id}", response_model=ListOut)
async def update_list(
    family_id: uuid.UUID,
    list_id: uuid.UUID,
    data: ListUpdate,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    lst = await _get_list_or_404(family_id, list_id, session)
    lst = await svc.update_list(lst, data, session)
    await bus.publish(str(family_id), "list.updated", {"id": str(lst.id)})
    return ListOut.model_validate(lst)


@router.delete("/families/{family_id}/lists/{list_id}", status_code=204)
async def delete_list(
    family_id: uuid.UUID,
    list_id: uuid.UUID,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    lst = await _get_list_or_404(family_id, list_id, session)
    await svc.soft_delete_list(lst, session)
    await bus.publish(str(family_id), "list.deleted", {"id": str(list_id)})


# ── Items ─────────────────────────────────────────────────────────────────────


@router.post(
    "/families/{family_id}/lists/{list_id}/items",
    response_model=ListItemOut,
    status_code=201,
)
async def add_item(
    family_id: uuid.UUID,
    list_id: uuid.UUID,
    data: ListItemCreate,
    _auth: FamilyActor,
    session: AsyncSession = Depends(get_session),
):
    lst = await _get_list_or_404(family_id, list_id, session)
    try:
        item = await svc.add_item(lst, data, family_id, session)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await bus.publish(
        str(family_id), "list.item_added", {"list_id": str(list_id), "id": str(item.id)}
    )
    return ListItemOut.model_validate(item)


# Declared before /items/{item_id} so "reorder" isn't parsed as an item id.
@router.post("/families/{family_id}/lists/{list_id}/items/reorder", status_code=204)
async def reorder_items(
    family_id: uuid.UUID,
    list_id: uuid.UUID,
    data: ItemReorder,
    _auth: FamilyActor,
    session: AsyncSession = Depends(get_session),
):
    lst = await _get_list_or_404(family_id, list_id, session)
    await svc.reorder_items(lst, data.item_ids, session)
    await bus.publish(str(family_id), "list.items_reordered", {"list_id": str(list_id)})


@router.patch(
    "/families/{family_id}/lists/{list_id}/items/{item_id}",
    response_model=ListItemOut,
)
async def update_item(
    family_id: uuid.UUID,
    list_id: uuid.UUID,
    item_id: uuid.UUID,
    data: ListItemUpdate,
    _auth: FamilyActor,
    session: AsyncSession = Depends(get_session),
):
    await _get_list_or_404(family_id, list_id, session)
    item = await svc.get_item(item_id, list_id, session)
    if not item:
        raise HTTPException(404, "Item not found")
    try:
        item = await svc.update_item(item, data, family_id, session)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await bus.publish(
        str(family_id), "list.item_updated", {"list_id": str(list_id), "id": str(item_id)}
    )
    return ListItemOut.model_validate(item)


@router.delete(
    "/families/{family_id}/lists/{list_id}/items/{item_id}", status_code=204
)
async def delete_item(
    family_id: uuid.UUID,
    list_id: uuid.UUID,
    item_id: uuid.UUID,
    _auth: FamilyActor,
    session: AsyncSession = Depends(get_session),
):
    await _get_list_or_404(family_id, list_id, session)
    item = await svc.get_item(item_id, list_id, session)
    if not item:
        raise HTTPException(404, "Item not found")
    await svc.soft_delete_item(item, session)
    await bus.publish(
        str(family_id), "list.item_deleted", {"list_id": str(list_id), "id": str(item_id)}
    )
