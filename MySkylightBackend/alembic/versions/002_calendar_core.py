"""Calendar core: calendars, events, event_exceptions, event_assignments, reminders, weather_cache

Revision ID: 002
Revises: 001
Create Date: 2026-06-12
"""

from alembic import op
import sqlalchemy as sa

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "calendars",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("color", sa.String(7), nullable=False, server_default="#6366f1"),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["family_id"], ["families.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_calendars_family_id", "calendars", ["family_id"])

    op.create_table(
        "events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("calendar_id", sa.Uuid(), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("location", sa.String(500), nullable=True),
        sa.Column("start_dt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_dt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("all_day", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("rrule", sa.String(1000), nullable=True),
        sa.Column("color", sa.String(7), nullable=True),
        sa.Column("is_countdown", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["calendar_id"], ["calendars.id"]),
        sa.ForeignKeyConstraint(["family_id"], ["families.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_events_calendar_id", "events", ["calendar_id"])
    op.create_index("ix_events_family_id", "events", ["family_id"])

    op.create_table(
        "event_exceptions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("original_date", sa.Date(), nullable=False),
        sa.Column("is_cancelled", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("title", sa.String(500), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("location", sa.String(500), nullable=True),
        sa.Column("start_dt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_dt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", "original_date"),
    )
    op.create_index("ix_event_exceptions_event_id", "event_exceptions", ["event_id"])

    op.create_table(
        "event_assignments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("member_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"]),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", "member_id"),
    )
    op.create_index("ix_event_assignments_event_id", "event_assignments", ["event_id"])
    op.create_index("ix_event_assignments_member_id", "event_assignments", ["member_id"])

    op.create_table(
        "reminders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("minutes_before", sa.Integer(), nullable=False, server_default="15"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_reminders_event_id", "reminders", ["event_id"])

    op.create_table(
        "weather_cache",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column("location_key", sa.String(64), nullable=False),
        sa.Column("forecast_date", sa.Date(), nullable=False),
        sa.Column("data", sa.Text(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["family_id"], ["families.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("family_id", "location_key", "forecast_date"),
    )
    op.create_index("ix_weather_cache_family_id", "weather_cache", ["family_id"])
    op.create_index("ix_weather_cache_forecast_date", "weather_cache", ["forecast_date"])


def downgrade() -> None:
    op.drop_table("weather_cache")
    op.drop_table("reminders")
    op.drop_table("event_assignments")
    op.drop_table("event_exceptions")
    op.drop_table("events")
    op.drop_table("calendars")
