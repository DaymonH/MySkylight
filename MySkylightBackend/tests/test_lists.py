"""Lists & groceries (FEATURES F04 / Phase 4).

Service-level tests cover list/item CRUD, check/uncheck (with checked_at), assignee
validation, and reorder. API-level tests cover the route surface and the role rules
(children may add/check items, viewers may not create lists).
"""

import uuid

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

import app.deps as deps_module
from app.main import app
from app.models.family import Family, Member, Membership, MembershipRole
from app.models.list import ListType
from app.models.user import User
from app.schemas.list import ListCreate, ListItemCreate, ListItemUpdate
from app.services import lists as svc


# ── helpers ───────────────────────────────────────────────────────────────────

async def _family_with_member(session: AsyncSession, color: str = "#abcdef"):
    family = Family(name="List Fam")
    session.add(family)
    await session.flush()
    member = Member(family_id=family.id, name="Cook", color=color)
    session.add(member)
    await session.flush()
    return family, member


def _auth_as(clerk_user_id: str) -> None:
    async def _verify(request: Request) -> str:  # request must be typed (see conftest note)
        return clerk_user_id

    app.dependency_overrides[deps_module.verify_clerk_token] = _verify


async def _make_user(session: AsyncSession, clerk_id: str, email: str) -> User:
    user = User(clerk_user_id=clerk_id, email=email)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


# ── service: list + item CRUD ──────────────────────────────────────────────────

async def test_create_list_add_items_and_check(session: AsyncSession):
    family, member = await _family_with_member(session)

    grocery = await svc.create_list(
        family.id, ListCreate(name="Groceries", list_type=ListType.grocery), session
    )
    assert grocery.list_type == ListType.grocery

    milk = await svc.add_item(
        grocery,
        ListItemCreate(text="Milk", quantity="2", category="Dairy", assignee_member_id=member.id),
        family.id,
        session,
    )
    eggs = await svc.add_item(grocery, ListItemCreate(text="Eggs"), family.id, session)
    # Appends to the end (Milk first, then Eggs).
    assert milk.sort_order == 0 and eggs.sort_order == 1
    assert milk.assignee_member_id == member.id

    # Check Milk → flips flag + stamps checked_at.
    milk = await svc.update_item(milk, ListItemUpdate(is_checked=True), family.id, session)
    assert milk.is_checked is True and milk.checked_at is not None

    # Uncheck → clears the stamp.
    milk = await svc.update_item(milk, ListItemUpdate(is_checked=False), family.id, session)
    assert milk.is_checked is False and milk.checked_at is None

    grocery = await svc.get_list(grocery.id, family.id, session)
    assert [i.text for i in grocery.items if not i.deleted_at] == ["Milk", "Eggs"]


async def test_item_assignee_must_be_family_member(session: AsyncSession):
    family, _ = await _family_with_member(session)
    _, other_member = await _family_with_member(session)  # different family
    lst = await svc.create_list(family.id, ListCreate(name="Chores"), session)
    try:
        await svc.add_item(
            lst, ListItemCreate(text="X", assignee_member_id=other_member.id), family.id, session
        )
        raise AssertionError("expected ValueError for a member of another family")
    except ValueError:
        pass


async def test_reorder_items(session: AsyncSession):
    family, _ = await _family_with_member(session)
    lst = await svc.create_list(family.id, ListCreate(name="ToDo"), session)
    a = await svc.add_item(lst, ListItemCreate(text="A"), family.id, session)
    b = await svc.add_item(lst, ListItemCreate(text="B"), family.id, session)
    c = await svc.add_item(lst, ListItemCreate(text="C"), family.id, session)

    lst = await svc.get_list(lst.id, family.id, session)
    await svc.reorder_items(lst, [c.id, a.id, b.id], session)

    lst = await svc.get_list(lst.id, family.id, session)
    ordered = sorted((i for i in lst.items if not i.deleted_at), key=lambda i: i.sort_order)
    assert [i.text for i in ordered] == ["C", "A", "B"]


async def test_soft_delete_item_hides_it(session: AsyncSession):
    family, _ = await _family_with_member(session)
    lst = await svc.create_list(family.id, ListCreate(name="ToDo"), session)
    item = await svc.add_item(lst, ListItemCreate(text="Temp"), family.id, session)

    item = await svc.get_item(item.id, lst.id, session)
    await svc.soft_delete_item(item, session)

    lst = await svc.get_list(lst.id, family.id, session)
    assert [i for i in lst.items if not i.deleted_at] == []


# ── API: CRUD ───────────────────────────────────────────────────────────────

async def test_list_crud_via_api(client, auth_headers):
    fam = (await client.post("/api/v1/families", json={"name": "Hansens"}, headers=auth_headers)).json()
    family_id = fam["id"]
    member_id = (
        await client.get(f"/api/v1/families/{family_id}/members", headers=auth_headers)
    ).json()[0]["id"]

    created = await client.post(
        f"/api/v1/families/{family_id}/lists",
        json={"name": "Groceries", "list_type": "grocery"},
        headers=auth_headers,
    )
    assert created.status_code == 201
    list_id = created.json()["id"]
    assert created.json()["list_type"] == "grocery"

    # Add an item assigned to the owner persona.
    item = await client.post(
        f"/api/v1/families/{family_id}/lists/{list_id}/items",
        json={"text": "Bananas", "quantity": "1 bunch", "category": "Produce", "assignee_member_id": member_id},
        headers=auth_headers,
    )
    assert item.status_code == 201
    item_id = item.json()["id"]
    assert item.json()["assignee"]["id"] == member_id

    # The list now nests the item.
    fetched = (await client.get(f"/api/v1/families/{family_id}/lists/{list_id}", headers=auth_headers)).json()
    assert [i["text"] for i in fetched["items"]] == ["Bananas"]

    # Check it off.
    checked = await client.patch(
        f"/api/v1/families/{family_id}/lists/{list_id}/items/{item_id}",
        json={"is_checked": True},
        headers=auth_headers,
    )
    assert checked.status_code == 200 and checked.json()["is_checked"] is True

    # Rename the list, then delete it.
    patched = await client.patch(
        f"/api/v1/families/{family_id}/lists/{list_id}",
        json={"name": "Weekly groceries"},
        headers=auth_headers,
    )
    assert patched.status_code == 200 and patched.json()["name"] == "Weekly groceries"

    deleted = await client.delete(
        f"/api/v1/families/{family_id}/lists/{list_id}", headers=auth_headers
    )
    assert deleted.status_code == 204
    after = (await client.get(f"/api/v1/families/{family_id}/lists", headers=auth_headers)).json()
    assert after == []


async def test_reorder_lists_via_api(client, auth_headers):
    fam = (await client.post("/api/v1/families", json={"name": "Fam"}, headers=auth_headers)).json()
    family_id = fam["id"]
    ids = []
    for name in ("A", "B", "C"):
        r = await client.post(
            f"/api/v1/families/{family_id}/lists", json={"name": name}, headers=auth_headers
        )
        ids.append(r.json()["id"])

    reorder = await client.post(
        f"/api/v1/families/{family_id}/lists/reorder",
        json={"list_ids": [ids[2], ids[0], ids[1]]},
        headers=auth_headers,
    )
    assert reorder.status_code == 204

    names = [lst["name"] for lst in (await client.get(f"/api/v1/families/{family_id}/lists", headers=auth_headers)).json()]
    assert names == ["C", "A", "B"]


# ── API: roles ────────────────────────────────────────────────────────────────

async def test_child_can_add_item_but_viewer_cannot_create_list(
    client, auth_headers, session: AsyncSession, test_user: User
):
    fam = (await client.post("/api/v1/families", json={"name": "Roles"}, headers=auth_headers)).json()
    family_id = fam["id"]
    member_id = (
        await client.get(f"/api/v1/families/{family_id}/members", headers=auth_headers)
    ).json()[0]["id"]

    list_id = (
        await client.post(
            f"/api/v1/families/{family_id}/lists",
            json={"name": "Shared", "list_type": "todo"},
            headers=auth_headers,
        )
    ).json()["id"]

    # A child member may add + check items.
    child = await _make_user(session, "user_child_l", "child_l@example.com")
    session.add(
        Membership(user_id=child.id, family_id=uuid.UUID(family_id), role=MembershipRole.child)
    )
    await session.commit()
    _auth_as(child.clerk_user_id)

    added = await client.post(
        f"/api/v1/families/{family_id}/lists/{list_id}/items",
        json={"text": "Take out trash", "assignee_member_id": member_id},
        headers=auth_headers,
    )
    assert added.status_code == 201

    # A viewer may not create a list.
    viewer = await _make_user(session, "user_viewer_l", "viewer_l@example.com")
    session.add(
        Membership(user_id=viewer.id, family_id=uuid.UUID(family_id), role=MembershipRole.viewer)
    )
    await session.commit()
    _auth_as(viewer.clerk_user_id)

    refused = await client.post(
        f"/api/v1/families/{family_id}/lists", json={"name": "Nope"}, headers=auth_headers
    )
    assert refused.status_code == 403
    assert refused.json()["detail"] == "Insufficient role"
