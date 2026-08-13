"""Recipe prep/cook time, source URL, and ingredient section grouping

Adds richer fields captured by Magic Import (F17) and editable in the recipe sheet:
prep/cook minutes and an origin URL on recipes, plus an optional grouping header on
ingredients. All bare nullable columns (no FK) — safe to add directly on SQLite.

Revision ID: 017
Revises: 016
Create Date: 2026-06-25
"""

from alembic import op
import sqlalchemy as sa

revision = "017"
down_revision = "016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("recipes", sa.Column("prep_minutes", sa.Integer(), nullable=True))
    op.add_column("recipes", sa.Column("cook_minutes", sa.Integer(), nullable=True))
    op.add_column("recipes", sa.Column("source_url", sa.String(1000), nullable=True))
    op.add_column("recipe_ingredients", sa.Column("section", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("recipe_ingredients", "section")
    op.drop_column("recipes", "source_url")
    op.drop_column("recipes", "cook_minutes")
    op.drop_column("recipes", "prep_minutes")
