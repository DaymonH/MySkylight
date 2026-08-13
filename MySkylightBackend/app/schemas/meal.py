import uuid
from datetime import date as _date
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.meal import MealSlot

# ── Recipes ───────────────────────────────────────────────────────────────────


class RecipeIngredientIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    quantity: float | None = Field(None, ge=0)
    unit: str | None = Field(None, max_length=50)
    section: str | None = Field(None, max_length=100)
    sort_order: int = 0


class RecipeIngredientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    quantity: float | None
    unit: str | None
    section: str | None
    sort_order: int


class RecipeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    instructions: str | None = None
    image_url: str | None = Field(None, max_length=1000)
    servings: int | None = Field(None, ge=0)
    prep_minutes: int | None = Field(None, ge=0)
    cook_minutes: int | None = Field(None, ge=0)
    source_url: str | None = Field(None, max_length=1000)
    tags: list[str] = []
    ingredients: list[RecipeIngredientIn] = []


class RecipeUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    instructions: str | None = None
    image_url: str | None = Field(None, max_length=1000)
    servings: int | None = Field(None, ge=0)
    prep_minutes: int | None = Field(None, ge=0)
    cook_minutes: int | None = Field(None, ge=0)
    source_url: str | None = Field(None, max_length=1000)
    tags: list[str] | None = None
    # When provided, replaces the whole ingredient set; omit to leave unchanged.
    ingredients: list[RecipeIngredientIn] | None = None


class RecipeBrief(BaseModel):
    id: uuid.UUID
    name: str
    image_url: str | None


class RecipeOut(BaseModel):
    id: uuid.UUID
    family_id: uuid.UUID
    name: str
    description: str | None
    instructions: str | None
    image_url: str | None
    servings: int | None
    prep_minutes: int | None
    cook_minutes: int | None
    source_url: str | None
    tags: list[str]
    ingredients: list[RecipeIngredientOut]
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="before")
    @classmethod
    def _from_orm(cls, v: Any) -> Any:
        if isinstance(v, dict):
            return v
        ingredients = sorted(
            getattr(v, "ingredients", []) or [], key=lambda i: (i.sort_order, i.created_at)
        )
        return {
            "id": v.id,
            "family_id": v.family_id,
            "name": v.name,
            "description": v.description,
            "instructions": v.instructions,
            "image_url": v.image_url,
            "servings": v.servings,
            "prep_minutes": v.prep_minutes,
            "cook_minutes": v.cook_minutes,
            "source_url": v.source_url,
            "tags": v.tags or [],
            "ingredients": ingredients,
            "created_at": v.created_at,
            "updated_at": v.updated_at,
        }


# ── Meal plans ────────────────────────────────────────────────────────────────


class MealPlanCreate(BaseModel):
    date: _date
    slot: MealSlot
    recipe_id: uuid.UUID | None = None
    title: str | None = Field(None, max_length=200)

    @model_validator(mode="after")
    def _recipe_or_title(self) -> "MealPlanCreate":
        if self.recipe_id is None and not (self.title and self.title.strip()):
            raise ValueError("A meal needs either a recipe_id or a title")
        return self


class MealPlanUpdate(BaseModel):
    date: _date | None = None
    slot: MealSlot | None = None
    recipe_id: uuid.UUID | None = None
    title: str | None = Field(None, max_length=200)


class MealPlanOut(BaseModel):
    id: uuid.UUID
    family_id: uuid.UUID
    date: _date
    slot: MealSlot
    recipe_id: uuid.UUID | None
    title: str | None
    display_title: str
    recipe: RecipeBrief | None
    calendar_event_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="before")
    @classmethod
    def _from_orm(cls, v: Any) -> Any:
        if isinstance(v, dict):
            return v
        r = getattr(v, "recipe", None)
        recipe = (
            {"id": r.id, "name": r.name, "image_url": r.image_url}
            if r is not None and not getattr(r, "deleted_at", None)
            else None
        )
        display = (recipe["name"] if recipe else None) or v.title or "Meal"
        return {
            "id": v.id,
            "family_id": v.family_id,
            "date": v.date,
            "slot": v.slot,
            "recipe_id": v.recipe_id,
            "title": v.title,
            "display_title": display,
            "recipe": recipe,
            "calendar_event_id": v.calendar_event_id,
            "created_at": v.created_at,
            "updated_at": v.updated_at,
        }


# ── Grocery aggregation (F28) ─────────────────────────────────────────────────


class GroceryAggregateRequest(BaseModel):
    """Source for an aggregation: explicit recipes and/or a meal-plan date range."""

    recipe_ids: list[uuid.UUID] = []
    from_date: _date | None = None
    to_date: _date | None = None

    @model_validator(mode="after")
    def _has_source(self) -> "GroceryAggregateRequest":
        if not self.recipe_ids and not (self.from_date and self.to_date):
            raise ValueError("Provide recipe_ids and/or a from_date + to_date range")
        if (self.from_date is None) != (self.to_date is None):
            raise ValueError("from_date and to_date must be given together")
        return self


class AggregatedLineOut(BaseModel):
    name: str
    quantity: float | None
    unit: str | None
    # Recipe names this line was rolled up from (for the review UI).
    from_recipes: list[str] = []


class GroceryBuildItem(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    quantity: str | None = Field(None, max_length=50)
    category: str | None = Field(None, max_length=100)


class GroceryBuildRequest(BaseModel):
    """Commit reviewed grocery lines into an existing or new grocery list."""

    list_id: uuid.UUID | None = None
    list_name: str | None = Field(None, max_length=100)
    items: list[GroceryBuildItem]

    @model_validator(mode="after")
    def _target(self) -> "GroceryBuildRequest":
        if self.list_id is None and not (self.list_name and self.list_name.strip()):
            raise ValueError("Provide a list_id or a list_name")
        return self
