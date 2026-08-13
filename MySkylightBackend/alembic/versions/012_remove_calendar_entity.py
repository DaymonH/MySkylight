"""Remove Calendar entity; events reference their ExternalCalendar source directly

Native events now belong to the family and are colored by their assigned member;
synced (read-only) events point at the ExternalCalendar they were mirrored from.
The local `calendars` container — and the ExternalCalendar -> Calendar mirror
indirection — is removed.

Revision ID: 012
Revises: 011
Create Date: 2026-06-20
"""

from alembic import op
import sqlalchemy as sa

revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. New columns: events.external_calendar_id (source link, NULL = native) and
    #    external_calendars.synced (the on/off the integrations toggle flips).
    with op.batch_alter_table("events") as batch_op:
        batch_op.add_column(sa.Column("external_calendar_id", sa.Uuid(), nullable=True))
        batch_op.create_foreign_key(
            "fk_events_external_calendar_id",
            "external_calendars",
            ["external_calendar_id"],
            ["id"],
        )
        batch_op.create_index("ix_events_external_calendar_id", ["external_calendar_id"])
    with op.batch_alter_table("external_calendars") as batch_op:
        batch_op.add_column(
            sa.Column("synced", sa.Boolean(), nullable=False, server_default="0")
        )

    # 2. Backfill. Link each mirrored event to its source by the external_id embedded
    #    in its ical_uid ("google:<external_id>:<id>" / "apple:<external_id>:<href>"),
    #    NOT by the old calendar_id — which can be shared when several external
    #    calendars were mapped into the same local calendar. Keying on the uid both
    #    assigns events correctly and untangles any such prior mis-mapping.
    op.execute(
        "UPDATE events SET external_calendar_id = ("
        " SELECT ec.id FROM external_calendars ec"
        " WHERE events.ical_uid LIKE 'google:' || ec.external_id || ':%' LIMIT 1)"
        " WHERE events.ical_uid LIKE 'google:%'"
    )
    op.execute(
        "UPDATE events SET external_calendar_id = ("
        " SELECT ec.id FROM external_calendars ec"
        " WHERE events.ical_uid LIKE 'apple:' || ec.external_id || ':%' LIMIT 1)"
        " WHERE events.ical_uid LIKE 'apple:%'"
    )
    # Preserve current on/off state: a calendar that had been mapped is now "synced".
    op.execute("UPDATE external_calendars SET synced = 1 WHERE calendar_id IS NOT NULL")

    # 3. Drop the old Calendar linkage from both tables. The index on each
    #    calendar_id must be dropped explicitly first — alembic's SQLite batch
    #    rebuild would otherwise try to recreate it against the dropped column.
    op.drop_index("ix_events_calendar_id", table_name="events")
    with op.batch_alter_table("events") as batch_op:
        batch_op.drop_column("calendar_id")
    op.drop_index("ix_external_calendars_calendar_id", table_name="external_calendars")
    with op.batch_alter_table("external_calendars") as batch_op:
        batch_op.drop_column("calendar_id")

    # 4. Drop the Calendar table itself.
    op.drop_table("calendars")


def downgrade() -> None:
    raise NotImplementedError(
        "Revision 012 is forward-only (it drops the calendars table). "
        "Restore from a database backup to revert."
    )
