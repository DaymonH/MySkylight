"""Meal planning + recipes (F15) and structured ingredients (F28)

Revision ID: 008
Revises: 007
Create Date: 2026-06-15
"""

from alembic import op
import sqlalchemy as sa

revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "recipes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("instructions", sa.Text(), nullable=True),
        sa.Column("image_url", sa.String(1000), nullable=True),
        sa.Column("servings", sa.Integer(), nullable=True),
        sa.Column("tags", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["family_id"], ["families.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_recipes_family_id", "recipes", ["family_id"])

    op.create_table(
        "recipe_ingredients",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("recipe_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("quantity", sa.Float(), nullable=True),
        sa.Column("unit", sa.String(50), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["recipe_id"], ["recipes.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_recipe_ingredients_recipe_id", "recipe_ingredients", ["recipe_id"])

    op.create_table(
        "meal_plans",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column(
            "slot",
            sa.Enum("breakfast", "lunch", "dinner", "snack", name="meal_slot"),
            nullable=False,
        ),
        sa.Column("recipe_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(200), nullable=True),
        sa.Column("calendar_event_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["family_id"], ["families.id"]),
        sa.ForeignKeyConstraint(["recipe_id"], ["recipes.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_meal_plans_family_id", "meal_plans", ["family_id"])
    op.create_index("ix_meal_plans_date", "meal_plans", ["date"])
    op.create_index("ix_meal_plans_recipe_id", "meal_plans", ["recipe_id"])


def downgrade() -> None:
    op.drop_table("meal_plans")
    op.drop_table("recipe_ingredients")
    op.drop_table("recipes")
