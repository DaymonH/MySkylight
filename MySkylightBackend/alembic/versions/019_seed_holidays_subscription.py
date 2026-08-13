"""Seed a read-only US-Holidays ICS feed subscription for every family (F25)

So a fresh deploy shows holidays with **zero app interaction**: this inserts an
`ExternalProvider.ics` "Subscribed feeds" container account (one per family) and a
synced `external_calendars` row pointing at a public US-Holidays `.ics` feed. The
existing 5-minute `external_sync` scheduler then pulls the events on its next tick
(this migration does NOT hit the network — no fetch in a migration). Future years
flow in automatically; nothing to re-import.

Idempotent: skips any family that already has the container account / this feed,
so re-runs (or a family that subscribed manually first) don't duplicate. Pure data
migration — no schema change (the `ics` enum value fits the existing bare-VARCHAR
`provider` column, so there's nothing to ALTER).

NOTE: this only runs on a real (SQLite) deploy via `alembic upgrade head`; the test
suite builds its schema from `Base.metadata`, not the migration chain, so tests are
unaffected. If a deploy's code is rolled back after this runs, the seeded `ics` rows
remain — acceptable since rollback only happens on an already-failed deploy.

Revision ID: 019
Revises: 018
Create Date: 2026-06-30
"""

import uuid

import sqlalchemy as sa
from alembic import op

revision = "019"
down_revision = "018"
branch_labels = None
depends_on = None

_LABEL = "Subscribed feeds"
_FEED_URL = (
    "https://calendar.google.com/calendar/ical/"
    "en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics"
)
_NAME = "US Holidays"
_COLOR = "#D93025"


def upgrade() -> None:
    bind = op.get_bind()
    families = bind.execute(
        sa.text("SELECT id FROM families WHERE deleted_at IS NULL")
    ).fetchall()

    for (family_id,) in families:
        account_id = bind.execute(
            sa.text(
                "SELECT id FROM external_accounts "
                "WHERE family_id = :f AND provider = 'ics' "
                "AND account_email = :label AND deleted_at IS NULL"
            ),
            {"f": family_id, "label": _LABEL},
        ).scalar()

        if account_id is None:
            account_id = uuid.uuid4().hex
            bind.execute(
                sa.text(
                    "INSERT INTO external_accounts "
                    "(id, family_id, provider, account_email, status) "
                    "VALUES (:id, :f, 'ics', :label, 'active')"
                ),
                {"id": account_id, "f": family_id, "label": _LABEL},
            )

        already = bind.execute(
            sa.text(
                "SELECT 1 FROM external_calendars "
                "WHERE account_id = :a AND external_id = :u"
            ),
            {"a": account_id, "u": _FEED_URL},
        ).first()
        if already is None:
            bind.execute(
                sa.text(
                    "INSERT INTO external_calendars "
                    "(id, account_id, family_id, external_id, name, color, synced) "
                    "VALUES (:id, :a, :f, :u, :n, :c, 1)"
                ),
                {
                    "id": uuid.uuid4().hex,
                    "a": account_id,
                    "f": family_id,
                    "u": _FEED_URL,
                    "n": _NAME,
                    "c": _COLOR,
                },
            )


def downgrade() -> None:
    bind = op.get_bind()
    # Remove the seeded feed, then any now-empty ICS container account.
    bind.execute(
        sa.text("DELETE FROM external_calendars WHERE external_id = :u"),
        {"u": _FEED_URL},
    )
    bind.execute(
        sa.text(
            "DELETE FROM external_accounts WHERE provider = 'ics' "
            "AND account_email = :label AND id NOT IN "
            "(SELECT account_id FROM external_calendars)"
        ),
        {"label": _LABEL},
    )
