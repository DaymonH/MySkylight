"""Saved per-family weather location (home location for forecasts)

Revision ID: 011
Revises: 010
Create Date: 2026-06-18
"""

from alembic import op
import sqlalchemy as sa

revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("families", sa.Column("weather_lat", sa.Float(), nullable=True))
    op.add_column("families", sa.Column("weather_lng", sa.Float(), nullable=True))
    op.add_column("families", sa.Column("weather_label", sa.String(120), nullable=True))


def downgrade() -> None:
    op.drop_column("families", "weather_label")
    op.drop_column("families", "weather_lng")
    op.drop_column("families", "weather_lat")
