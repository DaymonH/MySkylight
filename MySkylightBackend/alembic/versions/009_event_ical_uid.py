"""External iCalendar UID on events for .ics import/export dedup (F25)

Revision ID: 009
Revises: 008
Create Date: 2026-06-15
"""

from alembic import op
import sqlalchemy as sa

revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("events", sa.Column("ical_uid", sa.String(500), nullable=True))
    op.create_index("ix_events_ical_uid", "events", ["ical_uid"])


def downgrade() -> None:
    op.drop_index("ix_events_ical_uid", table_name="events")
    op.drop_column("events", "ical_uid")
