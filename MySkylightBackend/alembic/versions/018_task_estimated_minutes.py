"""Task estimated_minutes (time-to-do)

Adds an optional per-task time estimate in minutes — set in the task editor and
used by the chore balancer (F30) as the load weight instead of a coarse
light/medium/heavy. Bare nullable column (no FK) — safe to add directly on SQLite.

Revision ID: 018
Revises: 017
Create Date: 2026-06-29
"""

from alembic import op
import sqlalchemy as sa

revision = "018"
down_revision = "017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("estimated_minutes", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "estimated_minutes")
