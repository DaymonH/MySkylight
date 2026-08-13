import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.deps import AnyFamilyMember, FamilyOwnerOrAdult
from app.schemas.list import ListOut
from app.schemas.meal import (
    AggregatedLineOut,
    GroceryAggregateRequest,
    GroceryBuildRequest,
    MealPlanCreate,
    MealPlanOut,
    MealPlanUpdate,
    RecipeCreate,
    RecipeOut,
    RecipeUpdate,
)
from app.services import meals as svc
from app.services.realtime import bus

router = APIRouter(tags=["meals"])


# ── Recipes ───────────────────────────────────────────────────────────────────


@router.get("/families/{family_id}/recipes", response_model=list[RecipeOut])
async def list_recipes(
    family_id: uuid.UUID,
    _auth: AnyFamilyMember,
    session: AsyncSession = Depends(get_session),
):
    recipes = await svc.list_recipes(family_id, session)
    return [RecipeOut.model_validate(r) for r in recipes]


@router.post("/families/{family_id}/recipes", response_model=RecipeOut, status_code=201)
async def create_recipe(
    family_id: uuid.UUID,
    data: RecipeCreate,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    recipe = await svc.create_recipe(family_id, data, session)
    await bus.publish(str(family_id), "recipe.created", {"id": str(recipe.id)})
    return RecipeOut.model_validate(recipe)


async def _get_recipe_or_404(family_id: uuid.UUID, recipe_id: uuid.UUID, session: AsyncSession):
    recipe = await svc.get_recipe(recipe_id, family_id, session)
    if not recipe:
        raise HTTPException(404, "Recipe not found")
    return recipe


@router.get("/families/{family_id}/recipes/{recipe_id}", response_model=RecipeOut)
async def get_recipe(
    family_id: uuid.UUID,
    recipe_id: uuid.UUID,
    _auth: AnyFamilyMember,
    session: AsyncSession = Depends(get_session),
):
    return RecipeOut.model_validate(await _get_recipe_or_404(family_id, recipe_id, session))


@router.patch("/families/{family_id}/recipes/{recipe_id}", response_model=RecipeOut)
async def update_recipe(
    family_id: uuid.UUID,
    recipe_id: uuid.UUID,
    data: RecipeUpdate,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    recipe = await _get_recipe_or_404(family_id, recipe_id, session)
    recipe = await svc.update_recipe(recipe, data, session)
    await bus.publish(str(family_id), "recipe.updated", {"id": str(recipe.id)})
    return RecipeOut.model_validate(recipe)


@router.delete("/families/{family_id}/recipes/{recipe_id}", status_code=204)
async def delete_recipe(
    family_id: uuid.UUID,
    recipe_id: uuid.UUID,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    recipe = await _get_recipe_or_404(family_id, recipe_id, session)
    await svc.soft_delete_recipe(recipe, session)
    await bus.publish(str(family_id), "recipe.deleted", {"id": str(recipe_id)})


# ── Meal plans ────────────────────────────────────────────────────────────────


@router.get("/families/{family_id}/mealplans", response_model=list[MealPlanOut])
async def list_meals(
    family_id: uuid.UUID,
    _auth: AnyFamilyMember,
    from_: date | None = Query(None, alias="from"),
    to: date | None = Query(None, alias="to"),
    session: AsyncSession = Depends(get_session),
):
    meals = await svc.list_meals(family_id, from_, to, session)
    return [MealPlanOut.model_validate(m) for m in meals]


@router.post("/families/{family_id}/mealplans", response_model=MealPlanOut, status_code=201)
async def create_meal(
    family_id: uuid.UUID,
    data: MealPlanCreate,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    try:
        meal = await svc.create_meal(family_id, data, session)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await bus.publish(str(family_id), "mealplan.created", {"id": str(meal.id)})
    return MealPlanOut.model_validate(meal)


async def _get_meal_or_404(family_id: uuid.UUID, meal_id: uuid.UUID, session: AsyncSession):
    meal = await svc.get_meal(meal_id, family_id, session)
    if not meal:
        raise HTTPException(404, "Meal not found")
    return meal


@router.patch("/families/{family_id}/mealplans/{meal_id}", response_model=MealPlanOut)
async def update_meal(
    family_id: uuid.UUID,
    meal_id: uuid.UUID,
    data: MealPlanUpdate,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    meal = await _get_meal_or_404(family_id, meal_id, session)
    try:
        meal = await svc.update_meal(meal, data, session)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await bus.publish(str(family_id), "mealplan.updated", {"id": str(meal.id)})
    return MealPlanOut.model_validate(meal)


@router.delete("/families/{family_id}/mealplans/{meal_id}", status_code=204)
async def delete_meal(
    family_id: uuid.UUID,
    meal_id: uuid.UUID,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    meal = await _get_meal_or_404(family_id, meal_id, session)
    await svc.soft_delete_meal(meal, session)
    await bus.publish(str(family_id), "mealplan.deleted", {"id": str(meal_id)})


@router.post("/families/{family_id}/mealplans/{meal_id}/to-calendar", response_model=MealPlanOut)
async def meal_to_calendar(
    family_id: uuid.UUID,
    meal_id: uuid.UUID,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    meal = await _get_meal_or_404(family_id, meal_id, session)
    event = await svc.project_meal_to_calendar(family_id, meal, session)
    await bus.publish(str(family_id), "mealplan.updated", {"id": str(meal_id)})
    await bus.publish(str(family_id), "event.created", {"id": str(event.id)})
    return MealPlanOut.model_validate(await svc.get_meal(meal_id, family_id, session))


# ── Grocery aggregation (F28) ─────────────────────────────────────────────────


@router.post("/families/{family_id}/grocery/aggregate", response_model=list[AggregatedLineOut])
async def aggregate_grocery(
    family_id: uuid.UUID,
    data: GroceryAggregateRequest,
    _auth: AnyFamilyMember,
    session: AsyncSession = Depends(get_session),
):
    """Preview: aggregate ingredients from recipes/a meal-plan range (no write)."""
    return await svc.aggregate_grocery(family_id, data, session)


@router.post("/families/{family_id}/grocery/build", response_model=ListOut, status_code=201)
async def build_grocery(
    family_id: uuid.UUID,
    data: GroceryBuildRequest,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    """Commit reviewed lines into a new or existing grocery list."""
    try:
        lst = await svc.build_grocery(family_id, data, session)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await bus.publish(str(family_id), "list.updated", {"id": str(lst.id)})
    return ListOut.model_validate(lst)
