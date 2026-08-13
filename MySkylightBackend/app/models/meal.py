import enum
import uuid
from datetime import date as _date

from sqlalchemy import JSON, Date, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin


class MealSlot(str, enum.Enum):
    """Which part of the day a planned meal belongs to (F15)."""

    breakfast = "breakfast"
    lunch = "lunch"
    dinner = "dinner"
    snack = "snack"


class Recipe(Base, TimestampMixin, SoftDeleteMixin):
    """A saved recipe with structured ingredients (F15).

    Ingredients are stored as structured ``(quantity, unit, name)`` rows rather
    than free text so a meal plan can be aggregated into a grocery list (F28).
    """

    __tablename__ = "recipes"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    family_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("families.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    servings: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Prep/cook time in minutes (split, schema.org-style); either may be unknown.
    prep_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cook_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Origin URL when imported from a link (Magic Import F17) — for a "view original" link.
    source_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    # Free-form labels ("vegetarian", "quick") — stored as a JSON list of strings.
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)

    family: Mapped["Family"] = relationship()  # noqa: F821
    ingredients: Mapped[list["RecipeIngredient"]] = relationship(
        back_populates="recipe", cascade="all, delete-orphan"
    )


class RecipeIngredient(Base, TimestampMixin):
    """One structured ingredient line on a recipe (F28 aggregation source)."""

    __tablename__ = "recipe_ingredients"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    recipe_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("recipes.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    # Both optional: "salt to taste" has neither; "3 eggs" has qty but no unit.
    quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Optional grouping header ("For the sauce") — display-only; NULL = ungrouped.
    section: Mapped[str | None] = mapped_column(String(100), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    recipe: Mapped["Recipe"] = relationship(back_populates="ingredients")


class MealPlan(Base, TimestampMixin, SoftDeleteMixin):
    """A meal scheduled for a date + slot — either a saved recipe or free text (F15)."""

    __tablename__ = "meal_plans"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    family_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("families.id"), index=True)
    date: Mapped[_date] = mapped_column(Date, index=True)
    slot: Mapped[MealSlot] = mapped_column(Enum(MealSlot, name="meal_slot"))
    # A planned meal references a recipe OR carries free text (e.g. "Leftovers").
    recipe_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("recipes.id"), index=True, nullable=True
    )
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Set when this meal has been projected onto the calendar (F15 "add to calendar");
    # a soft reference (no FK) so re-projecting updates the same event instead of
    # duplicating, and deleting the event doesn't cascade back here.
    calendar_event_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)

    family: Mapped["Family"] = relationship()  # noqa: F821
    recipe: Mapped["Recipe | None"] = relationship()
