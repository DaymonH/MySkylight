"""Tests for auto-provisioned member personas (FEATURES F13)."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.family import Family, Member
from app.models.user import User
from app.services.members import ensure_member_for_user


async def _family(session: AsyncSession) -> Family:
    fam = Family(name="Fam")
    session.add(fam)
    await session.flush()
    return fam


async def test_ensure_member_creates_then_is_idempotent(session: AsyncSession, test_user: User):
    fam = await _family(session)

    member, created = await ensure_member_for_user(test_user, fam.id, session)
    assert created is True
    assert member.user_id == test_user.id
    assert member.name == "Test User"  # from first_name + last_name

    again, created2 = await ensure_member_for_user(test_user, fam.id, session)
    assert created2 is False
    assert again.id == member.id

    rows = (await session.execute(
        select(Member).where(Member.family_id == fam.id)
    )).scalars().all()
    assert len(rows) == 1  # no duplicate


async def test_ensure_member_name_falls_back_to_email_local_part(session: AsyncSession):
    user = User(clerk_user_id="u_noname", email="just.email@example.com")
    session.add(user)
    await session.flush()
    fam = await _family(session)

    member, _ = await ensure_member_for_user(user, fam.id, session)
    assert member.name == "just.email"


async def test_personas_get_distinct_colors_and_child_flag(session: AsyncSession, test_user: User):
    fam = await _family(session)
    parent, _ = await ensure_member_for_user(test_user, fam.id, session)

    kid_user = User(clerk_user_id="u_kid", email="kid@example.com", first_name="Kid")
    session.add(kid_user)
    await session.flush()
    kid, _ = await ensure_member_for_user(kid_user, fam.id, session, is_child=True)

    assert kid.is_child is True
    assert kid.color != parent.color  # next colour in the palette


async def test_create_family_seeds_owner_persona(client, auth_headers):
    resp = await client.post("/api/v1/families", json={"name": "The Hansens"}, headers=auth_headers)
    assert resp.status_code == 201
    family_id = resp.json()["id"]

    members = await client.get(f"/api/v1/families/{family_id}/members", headers=auth_headers)
    assert members.status_code == 200
    body = members.json()
    assert len(body) == 1
    assert body[0]["name"] == "Test User"
