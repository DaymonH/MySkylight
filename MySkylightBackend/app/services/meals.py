"""Meal planning + recipes (F15) and recipe→grocery aggregation (F28).

The aggregation here is deliberately pragmatic: ingredient names are lightly
canonicalized (lowercased, single trailing plural-``s`` dropped) and units are
mapped through a synonym table. Quantities are summed only within an identical
``(canonical name, canonical unit)`` group; different units for the same
ingredient stay on separate lines (we don't do cross-unit conversion). A review
step on the client lets the user fix anything before the list is written.
"""

import uuid
from datetime import datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.base import utcnow
from app.models.calendar import Event
from app.models.list import List, ListType
from app.models.meal import MealPlan, MealSlot, Recipe, RecipeIngredient
from app.schemas.event import EventCreate
from app.schemas.list import ListCreate, ListItemCreate
from app.schemas.meal import (
    AggregatedLineOut,
    GroceryAggregateRequest,
    GroceryBuildRequest,
    MealPlanCreate,
    MealPlanUpdate,
    RecipeCreate,
    RecipeUpdate,
)
from app.services import calendar as calendar_svc
from app.services import lists as lists_svc

# ── Recipes ───────────────────────────────────────────────────────────────────

_RECIPE_LOADS = [selectinload(Recipe.ingredients)]
_MEALPLAN_LOADS = [selectinload(MealPlan.recipe).selectinload(Recipe.ingredients)]


async def _reload_recipe(recipe_id: uuid.UUID, session: AsyncSession) -> Recipe:
    result = await session.execute(
        select(Recipe)
        .where(Recipe.id == recipe_id)
        .options(*_RECIPE_LOADS)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def list_recipes(family_id: uuid.UUID, session: AsyncSession) -> list[Recipe]:
    result = await session.execute(
        select(Recipe)
        .where(Recipe.family_id == family_id, Recipe.deleted_at.is_(None))
        .options(*_RECIPE_LOADS)
        .order_by(Recipe.name)
        .execution_options(populate_existing=True)
    )
    return list(result.scalars())


async def get_recipe(
    recipe_id: uuid.UUID, family_id: uuid.UUID, session: AsyncSession
) -> Recipe | None:
    result = await session.execute(
        select(Recipe)
        .where(
            Recipe.id == recipe_id,
            Recipe.family_id == family_id,
            Recipe.deleted_at.is_(None),
        )
        .options(*_RECIPE_LOADS)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


def _add_ingredients(recipe: Recipe, data: RecipeCreate | RecipeUpdate, session: AsyncSession) -> None:
    for idx, ing in enumerate(data.ingredients or []):
        session.add(
            RecipeIngredient(
                recipe_id=recipe.id,
                name=ing.name,
                quantity=ing.quantity,
                unit=ing.unit,
                section=ing.section,
                sort_order=ing.sort_order or idx,
            )
        )


async def create_recipe(family_id: uuid.UUID, data: RecipeCreate, session: AsyncSession) -> Recipe:
    recipe = Recipe(
        family_id=family_id,
        name=data.name,
        description=data.description,
        instructions=data.instructions,
        image_url=data.image_url,
        servings=data.servings,
        prep_minutes=data.prep_minutes,
        cook_minutes=data.cook_minutes,
        source_url=data.source_url,
        tags=data.tags,
    )
    session.add(recipe)
    await session.flush()
    _add_ingredients(recipe, data, session)
    await session.commit()
    return await _reload_recipe(recipe.id, session)


async def update_recipe(recipe: Recipe, data: RecipeUpdate, session: AsyncSession) -> Recipe:
    fields = data.model_dump(exclude_unset=True)
    for k in ("name",):
        if k in fields and fields[k] is not None:
            setattr(recipe, k, fields[k])
    for k in (
        "description", "instructions", "image_url", "servings",
        "prep_minutes", "cook_minutes", "source_url",
    ):  # nullable
        if k in fields:
            setattr(recipe, k, fields[k])
    if fields.get("tags") is not None:
        recipe.tags = fields["tags"]
    # An explicit ingredients list replaces the whole set.
    if data.ingredients is not None:
        for ing in list(recipe.ingredients):
            await session.delete(ing)
        await session.flush()
        _add_ingredients(recipe, data, session)
    await session.commit()
    return await _reload_recipe(recipe.id, session)


async def soft_delete_recipe(recipe: Recipe, session: AsyncSession) -> None:
    recipe.deleted_at = utcnow()
    await session.commit()


# ── Meal plans ────────────────────────────────────────────────────────────────


async def _reload_meal(meal_id: uuid.UUID, session: AsyncSession) -> MealPlan:
    result = await session.execute(
        select(MealPlan)
        .where(MealPlan.id == meal_id)
        .options(*_MEALPLAN_LOADS)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def _validate_recipe(
    recipe_id: uuid.UUID | None, family_id: uuid.UUID, session: AsyncSession
) -> None:
    if recipe_id is None:
        return
    result = await session.execute(
        select(Recipe.id).where(
            Recipe.id == recipe_id,
            Recipe.family_id == family_id,
            Recipe.deleted_at.is_(None),
        )
    )
    if result.scalar_one_or_none() is None:
        raise ValueError("Recipe not found in this family")


async def list_meals(
    family_id: uuid.UUID,
    from_date,
    to_date,
    session: AsyncSession,
) -> list[MealPlan]:
    q = select(MealPlan).where(
        MealPlan.family_id == family_id, MealPlan.deleted_at.is_(None)
    )
    if from_date is not None:
        q = q.where(MealPlan.date >= from_date)
    if to_date is not None:
        q = q.where(MealPlan.date <= to_date)
    result = await session.execute(
        q.options(*_MEALPLAN_LOADS)
        .order_by(MealPlan.date, MealPlan.slot)
        .execution_options(populate_existing=True)
    )
    return list(result.scalars())


async def get_meal(
    meal_id: uuid.UUID, family_id: uuid.UUID, session: AsyncSession
) -> MealPlan | None:
    result = await session.execute(
        select(MealPlan)
        .where(
            MealPlan.id == meal_id,
            MealPlan.family_id == family_id,
            MealPlan.deleted_at.is_(None),
        )
        .options(*_MEALPLAN_LOADS)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def create_meal(family_id: uuid.UUID, data: MealPlanCreate, session: AsyncSession) -> MealPlan:
    await _validate_recipe(data.recipe_id, family_id, session)
    meal = MealPlan(
        family_id=family_id,
        date=data.date,
        slot=data.slot,
        recipe_id=data.recipe_id,
        title=data.title,
    )
    session.add(meal)
    await session.commit()
    return await _reload_meal(meal.id, session)


async def update_meal(meal: MealPlan, data: MealPlanUpdate, session: AsyncSession) -> MealPlan:
    fields = data.model_dump(exclude_unset=True)
    if "recipe_id" in fields:
        await _validate_recipe(fields["recipe_id"], meal.family_id, session)
        meal.recipe_id = fields["recipe_id"]
    for k in ("date", "slot"):
        if k in fields and fields[k] is not None:
            setattr(meal, k, fields[k])
    if "title" in fields:
        meal.title = fields["title"]
    await session.commit()
    return await _reload_meal(meal.id, session)


async def soft_delete_meal(meal: MealPlan, session: AsyncSession) -> None:
    meal.deleted_at = utcnow()
    await session.commit()


# ── Meal → calendar projection (F15) ──────────────────────────────────────────

# Default clock time per slot when a meal is shown on the calendar.
_SLOT_TIME: dict[MealSlot, time] = {
    MealSlot.breakfast: time(8, 0),
    MealSlot.lunch: time(12, 0),
    MealSlot.dinner: time(18, 0),
    MealSlot.snack: time(15, 0),
}


def _meal_title(meal: MealPlan) -> str:
    name = meal.recipe.name if meal.recipe and not meal.recipe.deleted_at else None
    return name or meal.title or "Meal"


async def project_meal_to_calendar(
    family_id: uuid.UUID,
    meal: MealPlan,
    session: AsyncSession,
) -> Event:
    """Create (or update, if already projected) a native calendar event for this meal."""
    start = datetime.combine(meal.date, _SLOT_TIME[meal.slot], tzinfo=timezone.utc)
    end = start + timedelta(minutes=45)
    title = _meal_title(meal)

    # Re-projecting an already-linked meal updates the same event in place.
    if meal.calendar_event_id is not None:
        existing = await calendar_svc.get_event(meal.calendar_event_id, family_id, session)
        if existing is not None:
            existing.title = title
            existing.start_dt = start
            existing.end_dt = end
            await session.commit()
            return existing

    event = await calendar_svc.create_event(
        family_id,
        EventCreate(title=title, start_dt=start, end_dt=end),
        session,
    )
    meal.calendar_event_id = event.id
    await session.commit()
    return event


# ── Grocery aggregation (F28) ─────────────────────────────────────────────────

# Unit synonyms → a single canonical token. Quantities only sum within a shared
# canonical unit; unknown units pass through normalized (lowercased) and merge
# only with an identical spelling.
_UNIT_SYNONYMS: dict[str, str] = {
    "tsp": "tsp", "teaspoon": "tsp", "teaspoons": "tsp",
    "tbsp": "tbsp", "tablespoon": "tbsp", "tablespoons": "tbsp",
    "cup": "cup", "cups": "cup",
    "oz": "oz", "ounce": "oz", "ounces": "oz",
    "lb": "lb", "lbs": "lb", "pound": "lb", "pounds": "lb",
    "g": "g", "gram": "g", "grams": "g",
    "kg": "kg", "kilogram": "kg", "kilograms": "kg",
    "ml": "ml", "milliliter": "ml", "milliliters": "ml",
    "l": "l", "liter": "l", "liters": "l", "litre": "l", "litres": "l",
    "clove": "clove", "cloves": "clove",
    "can": "can", "cans": "can",
    "pinch": "pinch", "pinches": "pinch",
}


def _canon_unit(unit: str | None) -> str | None:
    if not unit or not unit.strip():
        return None
    key = unit.strip().lower()
    return _UNIT_SYNONYMS.get(key, key)


def _canon_name(name: str) -> str:
    n = name.strip().lower()
    # Light singularization so "eggs" merges with "egg"; conservative on "ss".
    if len(n) > 3 and n.endswith("s") and not n.endswith("ss"):
        n = n[:-1]
    return n


def aggregate_ingredients(recipes: list[Recipe]) -> list[AggregatedLineOut]:
    """Merge ingredients across recipes (repeats count), summing like quantities."""
    groups: dict[tuple[str, str | None], dict] = {}
    order: list[tuple[str, str | None]] = []
    for recipe in recipes:
        for ing in sorted(recipe.ingredients, key=lambda i: i.sort_order):
            key = (_canon_name(ing.name), _canon_unit(ing.unit))
            g = groups.get(key)
            if g is None:
                g = {
                    "display": ing.name.strip(),
                    "unit": ing.unit.strip() if ing.unit and ing.unit.strip() else None,
                    "quantity": None,
                    "from": [],
                }
                groups[key] = g
                order.append(key)
            if recipe.name not in g["from"]:
                g["from"].append(recipe.name)
            if ing.quantity is not None:
                g["quantity"] = (g["quantity"] or 0.0) + ing.quantity
    lines: list[AggregatedLineOut] = []
    for key in order:
        g = groups[key]
        qty = g["quantity"]
        # Render whole numbers without a trailing ".0" (3.0 eggs → 3 eggs).
        if qty is not None and float(qty).is_integer():
            qty = float(int(qty))
        lines.append(
            AggregatedLineOut(
                name=g["display"], quantity=qty, unit=g["unit"], from_recipes=g["from"]
            )
        )
    return lines


async def aggregate_grocery(
    family_id: uuid.UUID, data: GroceryAggregateRequest, session: AsyncSession
) -> list[AggregatedLineOut]:
    recipes: list[Recipe] = []

    # Explicitly selected recipes — fetched in one IN(...) query, then re-ordered to
    # match the request (each contributes once).
    if data.recipe_ids:
        result = await session.execute(
            select(Recipe)
            .where(
                Recipe.id.in_(data.recipe_ids),
                Recipe.family_id == family_id,
                Recipe.deleted_at.is_(None),
            )
            .options(*_RECIPE_LOADS)
        )
        by_id = {r.id: r for r in result.scalars()}
        recipes.extend(by_id[rid] for rid in data.recipe_ids if rid in by_id)

    # Every recipe referenced by a meal plan in the range (repeats count).
    if data.from_date and data.to_date:
        meals = await list_meals(family_id, data.from_date, data.to_date, session)
        for meal in meals:
            if meal.recipe is not None and not meal.recipe.deleted_at:
                recipes.append(meal.recipe)

    return aggregate_ingredients(recipes)


def _fmt_quantity(line) -> str | None:
    """A grocery item's free-text quantity from an aggregated line."""
    if line.quantity is None:
        return line.unit
    qty = int(line.quantity) if float(line.quantity).is_integer() else line.quantity
    return f"{qty} {line.unit}".strip() if line.unit else str(qty)


async def build_grocery(
    family_id: uuid.UUID, data: GroceryBuildRequest, session: AsyncSession
) -> List:
    """Write reviewed grocery lines into a new or existing grocery list (F28)."""
    if data.list_id is not None:
        lst = await lists_svc.get_list(data.list_id, family_id, session)
        if lst is None:
            raise ValueError("List not found")
    else:
        lst = await lists_svc.create_list(
            family_id,
            ListCreate(name=data.list_name, list_type=ListType.grocery),
            session,
        )
    for item in data.items:
        await lists_svc.add_item(
            lst,
            ListItemCreate(text=item.text, quantity=item.quantity, category=item.category),
            family_id,
            session,
        )
    return await lists_svc.get_list(lst.id, family_id, session)
