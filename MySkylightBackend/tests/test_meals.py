"""Meal planning + recipes (F15) and recipe→grocery aggregation (F28).

Service-level tests cover recipe/meal CRUD, the ingredient aggregation math
(summing like units, keeping incompatible units separate, repeats from a meal
plan), the grocery build, and meal→calendar projection. API-level tests cover
the route surface + role rules (owner/adult manage; viewers are read-only).
"""

import uuid

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import app.deps as deps_module
from app.main import app
from app.models.calendar import Event
from app.models.family import Family, Member, Membership, MembershipRole
from app.models.user import User
from app.models.meal import MealSlot
from app.schemas.meal import (
    GroceryAggregateRequest,
    GroceryBuildItem,
    GroceryBuildRequest,
    MealPlanCreate,
    MealPlanUpdate,
    RecipeCreate,
    RecipeIngredientIn,
    RecipeUpdate,
)
from app.services import meals as svc


# ── helpers ───────────────────────────────────────────────────────────────────

async def _family(session: AsyncSession) -> Family:
    family = Family(name="Meal Fam")
    session.add(family)
    await session.flush()
    return family


def _ing(name: str, qty: float | None = None, unit: str | None = None) -> RecipeIngredientIn:
    return RecipeIngredientIn(name=name, quantity=qty, unit=unit)


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


# ── service: recipe CRUD ────────────────────────────────────────────────────────

async def test_recipe_crud_with_ingredients(session: AsyncSession):
    family = await _family(session)

    recipe = await svc.create_recipe(
        family.id,
        RecipeCreate(
            name="Pancakes",
            instructions="Mix and fry.",
            servings=4,
            tags=["breakfast", "kid-friendly"],
            ingredients=[_ing("Flour", 2, "cups"), _ing("Eggs", 2), _ing("Salt")],
        ),
        session,
    )
    assert recipe.servings == 4
    assert recipe.tags == ["breakfast", "kid-friendly"]
    assert [i.name for i in sorted(recipe.ingredients, key=lambda x: x.sort_order)] == [
        "Flour", "Eggs", "Salt",
    ]

    # Update replaces the whole ingredient set + clears a nullable field.
    recipe = await svc.update_recipe(
        recipe,
        RecipeUpdate(servings=None, ingredients=[_ing("Flour", 3, "cups")]),
        session,
    )
    assert recipe.servings is None
    assert [i.name for i in recipe.ingredients] == ["Flour"]
    assert recipe.ingredients[0].quantity == 3

    await svc.soft_delete_recipe(recipe, session)
    assert await svc.get_recipe(recipe.id, family.id, session) is None


# ── service: meal-plan CRUD + range ─────────────────────────────────────────────

async def test_mealplan_crud_and_range(session: AsyncSession):
    family = await _family(session)
    from datetime import date

    recipe = await svc.create_recipe(family.id, RecipeCreate(name="Tacos"), session)

    m1 = await svc.create_meal(
        family.id,
        MealPlanCreate(date=date(2026, 6, 15), slot=MealSlot.dinner, recipe_id=recipe.id),
        session,
    )
    # Free-text meal (no recipe).
    await svc.create_meal(
        family.id,
        MealPlanCreate(date=date(2026, 6, 16), slot=MealSlot.lunch, title="Leftovers"),
        session,
    )
    # Outside the queried range.
    await svc.create_meal(
        family.id,
        MealPlanCreate(date=date(2026, 7, 1), slot=MealSlot.dinner, title="Pizza"),
        session,
    )

    week = await svc.list_meals(family.id, date(2026, 6, 15), date(2026, 6, 21), session)
    assert [m.date.isoformat() for m in week] == ["2026-06-15", "2026-06-16"]
    assert week[0].recipe is not None and week[0].recipe.name == "Tacos"

    m1 = await svc.update_meal(m1, MealPlanUpdate(slot=MealSlot.lunch), session)
    assert m1.slot == MealSlot.lunch

    await svc.soft_delete_meal(m1, session)
    remaining = await svc.list_meals(family.id, date(2026, 6, 15), date(2026, 6, 21), session)
    assert [m.title for m in remaining] == ["Leftovers"]


async def test_meal_recipe_must_belong_to_family(session: AsyncSession):
    family = await _family(session)
    other = await _family(session)
    from datetime import date

    foreign = await svc.create_recipe(other.id, RecipeCreate(name="Secret"), session)
    try:
        await svc.create_meal(
            family.id,
            MealPlanCreate(date=date(2026, 6, 15), slot=MealSlot.dinner, recipe_id=foreign.id),
            session,
        )
        raise AssertionError("expected ValueError for a recipe of another family")
    except ValueError:
        pass


# ── service: aggregation (F28) ──────────────────────────────────────────────────

async def test_aggregate_sums_and_separates_units(session: AsyncSession):
    family = await _family(session)

    await svc.create_recipe(
        family.id,
        RecipeCreate(
            name="Omelette",
            ingredients=[_ing("Eggs", 2), _ing("Flour", 1, "cup"), _ing("Salt")],
        ),
        session,
    )
    await svc.create_recipe(
        family.id,
        RecipeCreate(
            name="Cake",
            # 3 more eggs (sums), flour by weight (incompatible unit → separate line),
            # "tablespoon" should normalize to match "tbsp" elsewhere if present.
            ingredients=[_ing("eggs", 3), _ing("Flour", 200, "g")],
        ),
        session,
    )

    lines = svc.aggregate_ingredients(await svc.list_recipes(family.id, session))

    by_key = {(line.name.lower(), line.unit): line for line in lines}

    # Eggs: 2 + 3 = 5, no unit, rolled up from both recipes.
    eggs = by_key[("eggs", None)]
    assert eggs.quantity == 5
    assert sorted(eggs.from_recipes) == ["Cake", "Omelette"]

    # Flour appears twice with incompatible units → two separate lines.
    assert by_key[("flour", "cup")].quantity == 1
    assert by_key[("flour", "g")].quantity == 200

    # Salt has no quantity → line present with quantity None.
    assert by_key[("salt", None)].quantity is None


async def test_aggregate_from_mealplan_counts_repeats(session: AsyncSession):
    family = await _family(session)
    from datetime import date

    recipe = await svc.create_recipe(
        family.id,
        RecipeCreate(name="Spaghetti", ingredients=[_ing("Pasta", 1, "lb"), _ing("Sauce", 1, "can")]),
        session,
    )
    # Same recipe planned on two days → ingredients should count twice.
    for d in (date(2026, 6, 15), date(2026, 6, 17)):
        await svc.create_meal(
            family.id,
            MealPlanCreate(date=d, slot=MealSlot.dinner, recipe_id=recipe.id),
            session,
        )

    lines = await svc.aggregate_grocery(
        family.id,
        GroceryAggregateRequest(from_date=date(2026, 6, 15), to_date=date(2026, 6, 21)),
        session,
    )
    by_name = {line.name.lower(): line for line in lines}
    assert by_name["pasta"].quantity == 2
    assert by_name["sauce"].quantity == 2


# ── service: build grocery list ─────────────────────────────────────────────────

async def test_build_grocery_new_and_existing(session: AsyncSession):
    family = await _family(session)

    lst = await svc.build_grocery(
        family.id,
        GroceryBuildRequest(
            list_name="Week groceries",
            items=[
                GroceryBuildItem(text="Eggs", quantity="5"),
                GroceryBuildItem(text="Flour", quantity="1 cup", category="Baking"),
            ],
        ),
        session,
    )
    assert lst.name == "Week groceries"
    assert {i.text for i in lst.items if not i.deleted_at} == {"Eggs", "Flour"}

    # Building into the same list appends.
    lst = await svc.build_grocery(
        family.id,
        GroceryBuildRequest(list_id=lst.id, items=[GroceryBuildItem(text="Milk")]),
        session,
    )
    assert {i.text for i in lst.items if not i.deleted_at} == {"Eggs", "Flour", "Milk"}


# ── service: meal → calendar ────────────────────────────────────────────────────

async def test_meal_to_calendar_creates_then_updates_one_event(session: AsyncSession):
    family = await _family(session)
    from datetime import date

    recipe = await svc.create_recipe(family.id, RecipeCreate(name="Roast Chicken"), session)
    meal = await svc.create_meal(
        family.id,
        MealPlanCreate(date=date(2026, 6, 15), slot=MealSlot.dinner, recipe_id=recipe.id),
        session,
    )

    event = await svc.project_meal_to_calendar(family.id, meal, session)
    assert event.title == "Roast Chicken"
    assert meal.calendar_event_id == event.id

    # Re-projecting updates the same event instead of creating a duplicate.
    again = await svc.project_meal_to_calendar(family.id, meal, session)
    assert again.id == event.id
    count = (
        await session.execute(
            select(func.count()).select_from(Event).where(Event.family_id == family.id)
        )
    ).scalar_one()
    assert count == 1


# ── API: happy path + roles ─────────────────────────────────────────────────────

async def test_recipe_meal_aggregate_flow_via_api(client, auth_headers):
    fam = (await client.post("/api/v1/families", json={"name": "Hansens"}, headers=auth_headers)).json()
    family_id = fam["id"]

    recipe = await client.post(
        f"/api/v1/families/{family_id}/recipes",
        json={
            "name": "Chili",
            "ingredients": [
                {"name": "Beans", "quantity": 2, "unit": "can"},
                {"name": "Onion", "quantity": 1},
            ],
        },
        headers=auth_headers,
    )
    assert recipe.status_code == 201
    recipe_id = recipe.json()["id"]
    assert len(recipe.json()["ingredients"]) == 2

    meal = await client.post(
        f"/api/v1/families/{family_id}/mealplans",
        json={"date": "2026-06-15", "slot": "dinner", "recipe_id": recipe_id},
        headers=auth_headers,
    )
    assert meal.status_code == 201
    assert meal.json()["display_title"] == "Chili"

    week = await client.get(
        f"/api/v1/families/{family_id}/mealplans?from=2026-06-15&to=2026-06-21",
        headers=auth_headers,
    )
    assert [m["display_title"] for m in week.json()] == ["Chili"]

    # Aggregate from the planned week, then build a grocery list from the result.
    agg = await client.post(
        f"/api/v1/families/{family_id}/grocery/aggregate",
        json={"from_date": "2026-06-15", "to_date": "2026-06-21"},
        headers=auth_headers,
    )
    assert agg.status_code == 200
    names = {line["name"].lower() for line in agg.json()}
    assert names == {"beans", "onion"}

    built = await client.post(
        f"/api/v1/families/{family_id}/grocery/build",
        json={
            "list_name": "Dinner groceries",
            "items": [{"text": "Beans", "quantity": "2 can"}, {"text": "Onion", "quantity": "1"}],
        },
        headers=auth_headers,
    )
    assert built.status_code == 201
    assert built.json()["list_type"] == "grocery"
    assert {i["text"] for i in built.json()["items"]} == {"Beans", "Onion"}


async def test_recipe_roles_via_api(client, auth_headers, session: AsyncSession, test_user: User):
    fam = (await client.post("/api/v1/families", json={"name": "Roles"}, headers=auth_headers)).json()
    family_id = fam["id"]

    # A viewer may not create a recipe.
    viewer = await _make_user(session, "user_viewer_m", "viewer_m@example.com")
    session.add(
        Membership(user_id=viewer.id, family_id=uuid.UUID(family_id), role=MembershipRole.viewer)
    )
    await session.commit()
    _auth_as(viewer.clerk_user_id)

    refused = await client.post(
        f"/api/v1/families/{family_id}/recipes", json={"name": "Nope"}, headers=auth_headers
    )
    assert refused.status_code == 403
    assert refused.json()["detail"] == "Insufficient role"

    # A viewer may still read recipes.
    listed = await client.get(f"/api/v1/families/{family_id}/recipes", headers=auth_headers)
    assert listed.status_code == 200
