"""Dump the live DB schema to docs/schema.sql — a drift-proof, committed reference.

This file is GENERATED. Never hand-edit docs/schema.sql. Regenerate after any
model/migration change:

    source venv/bin/activate
    make schema                       # or: python scripts/dump_schema.py

How it works: applies the *entire* Alembic chain to a throwaway SQLite database
(which also verifies the chain still applies cleanly), then writes the resulting
CREATE statements. Output is deterministic — no timestamps — so the file only
changes when the schema actually changes, keeping diffs meaningful.

Source of truth is still app/models/*.py + alembic/versions/; this is a
read-at-a-glance mirror so a new session doesn't have to reconstruct the schema.
"""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

API_ROOT = Path(__file__).resolve().parent.parent  # skylight-api/
OUT_PATH = API_ROOT / "docs" / "schema.sql"


def build_db(db_file: Path) -> None:
    """Apply all migrations to a fresh SQLite file via `alembic upgrade head`.

    Uses `python -m alembic` (this interpreter) so it works whether or not the
    venv is activated, as long as the script is run with the project's python.
    """
    env = {**os.environ, "DATABASE_URL": f"sqlite+aiosqlite:///{db_file}"}
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=API_ROOT,
        env=env,
        check=True,
        stdout=subprocess.DEVNULL,
    )


def dump_schema(db_file: Path) -> str:
    con = sqlite3.connect(str(db_file))
    try:
        row = con.execute("SELECT version_num FROM alembic_version").fetchone()
        head_rev = row[0] if row else "unknown"
        # Tables first, then each table's indexes immediately after it.
        objects = con.execute(
            """
            SELECT tbl_name, sql
            FROM sqlite_master
            WHERE sql IS NOT NULL
              AND name NOT LIKE 'sqlite_%'
              AND name != 'alembic_version'
            ORDER BY tbl_name, (type = 'index'), name
            """
        ).fetchall()
    finally:
        con.close()

    lines = [
        "-- AUTO-GENERATED — do not edit by hand.",
        "-- Regenerate with `make schema` (or `python scripts/dump_schema.py`) after any",
        "-- model/migration change. Built by applying the full Alembic chain to a fresh DB.",
        "-- Source of truth = app/models/*.py + alembic/versions/; this is a convenience mirror.",
        f"-- Alembic head: {head_rev}",
    ]
    current_table: str | None = None
    for tbl_name, sql in objects:
        if tbl_name != current_table:
            lines.append("")  # blank line between tables
            current_table = tbl_name
        lines.append(f"{sql.strip()};")
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        db_file = Path(tmp) / "schema_dump.db"
        build_db(db_file)
        schema = dump_schema(db_file)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(schema)
    print(f"Wrote {OUT_PATH.relative_to(API_ROOT)} ({schema.count(';')} objects)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
