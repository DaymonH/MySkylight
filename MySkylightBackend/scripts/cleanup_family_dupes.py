"""Soft-delete duplicate 'Family' calendars, keeping the oldest per family.

Usage:
  python scripts/cleanup_family_dupes.py            # dry-run (no writes)
  python scripts/cleanup_family_dupes.py --apply    # actually write

Behaviour:
  - Per family, keep the oldest non-deleted calendar named 'Family'.
  - Reassign any non-deleted events on a duplicate to the keeper.
  - Soft-delete (set deleted_at = CURRENT_TIMESTAMP) on the duplicates.
  - Wraps everything in a single transaction. Rolls back on any error.
"""
import argparse
import sqlite3
import sys
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "myskylight.db"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true",
                        help="Commit changes. Without this flag the script is a dry-run.")
    args = parser.parse_args()

    if not DB_PATH.exists():
        print(f"DB not found: {DB_PATH}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    try:
        conn.execute("BEGIN")

        # Pick the oldest non-deleted 'Family' calendar per family.
        keepers = conn.execute("""
            SELECT family_id, id AS keeper_id
            FROM (
                SELECT family_id, id,
                       ROW_NUMBER() OVER (
                           PARTITION BY family_id
                           ORDER BY created_at ASC, id ASC
                       ) AS rn
                FROM calendars
                WHERE name = 'Family' AND deleted_at IS NULL
            )
            WHERE rn = 1
        """).fetchall()

        if not keepers:
            print("No 'Family' calendars found. Nothing to do.")
            conn.rollback()
            return 0

        keeper_by_family = {r["family_id"]: r["keeper_id"] for r in keepers}
        print(f"Keeping {len(keeper_by_family)} calendar(s) (one per family):")
        for fam, keeper in keeper_by_family.items():
            print(f"  family={fam}  keeper={keeper}")

        # Identify duplicates.
        dupes = conn.execute("""
            SELECT c.id, c.family_id, c.created_at
            FROM calendars c
            WHERE c.name = 'Family'
              AND c.deleted_at IS NULL
              AND c.id NOT IN (SELECT keeper_id FROM (
                  SELECT family_id, id AS keeper_id
                  FROM (
                      SELECT family_id, id,
                             ROW_NUMBER() OVER (
                                 PARTITION BY family_id
                                 ORDER BY created_at ASC, id ASC
                             ) AS rn
                      FROM calendars
                      WHERE name = 'Family' AND deleted_at IS NULL
                  )
                  WHERE rn = 1
              ))
            ORDER BY c.family_id, c.created_at
        """).fetchall()
        dupe_ids = [r["id"] for r in dupes]
        print(f"\nDuplicates to soft-delete: {len(dupe_ids)}")

        if not dupe_ids:
            print("Nothing to clean up.")
            conn.rollback()
            return 0

        # Count events on dupes (should be zero in our case, but handle generally).
        placeholders = ",".join("?" * len(dupe_ids))
        event_rows = conn.execute(
            f"SELECT id, calendar_id FROM events "
            f"WHERE deleted_at IS NULL AND calendar_id IN ({placeholders})",
            dupe_ids,
        ).fetchall()
        print(f"Events on duplicates to reassign: {len(event_rows)}")

        # Reassign events to the keeper for the same family.
        if event_rows:
            for ev in event_rows:
                # find which family owns this dupe calendar
                row = conn.execute(
                    "SELECT family_id FROM calendars WHERE id = ?",
                    (ev["calendar_id"],),
                ).fetchone()
                keeper = keeper_by_family[row["family_id"]]
                conn.execute(
                    "UPDATE events SET calendar_id = ?, "
                    "updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (keeper, ev["id"]),
                )

        # Soft-delete the duplicate calendars.
        conn.execute(
            f"UPDATE calendars SET deleted_at = CURRENT_TIMESTAMP, "
            f"updated_at = CURRENT_TIMESTAMP WHERE id IN ({placeholders})",
            dupe_ids,
        )

        # Verification.
        remaining = conn.execute("""
            SELECT family_id, COUNT(*) AS n
            FROM calendars
            WHERE name = 'Family' AND deleted_at IS NULL
            GROUP BY family_id
            HAVING COUNT(*) <> 1
        """).fetchall()
        if remaining:
            print("\nVERIFICATION FAILED — these families still have != 1 'Family' calendar:")
            for r in remaining:
                print(f"  {dict(r)}")
            print("Rolling back.")
            conn.rollback()
            return 2

        if args.apply:
            conn.commit()
            print("\nCOMMITTED. Cleanup complete.")
        else:
            conn.rollback()
            print("\nDRY-RUN: changes rolled back. Re-run with --apply to commit.")

        return 0

    except Exception as exc:
        conn.rollback()
        print(f"Error, rolled back: {exc}", file=sys.stderr)
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
