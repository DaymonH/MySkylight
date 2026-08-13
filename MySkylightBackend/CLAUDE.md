# CLAUDE.md — MySkylight Backend (`skylight-api`)

FastAPI + SQLite backend for **MySkylight**, a self-hosted clone of the Skylight Family
Calendar (a wall-mounted touchscreen "hub of the home" + companion PWA). Runs on port **8001**.

## ⚠️ Read the canonical docs first
The full architecture, feature specs, and live progress live in the **frontend** repo's `docs/` set
(different tree — these are *not* auto-loaded, read them when you need depth):

(with the two repos checked out side by side, these resolve to `../../MySkylight/docs/` from here)

- **`../../MySkylight/docs/PLAN.md`** — architecture, stack, phased roadmap, decisions
- **`../../MySkylight/docs/FEATURES.md`** — per-feature specs with stable `Fxx` IDs + acceptance criteria
- **`../../MySkylight/docs/TRACKER.md`** — phase-by-phase checklist (FE detail in Appendices A–B)
- **`../../MySkylight/docs/PERFORMANCE.md`** — perf findings + plan (cross-repo). Backend top items:
  add the missing **`members.family_id`** index, take JWKS/crypto off the event loop, clamp the
  occurrence date-window. Engine is *not* the bottleneck (see `docs/postgres-migration.md`).

> **Doing data / model / migration work? Start here, don't reverse-engineer:** read
> **`../../MySkylight/docs/PLAN.md` §5 (Data model)** for the entity map + the load-bearing FKs and
> invariants, then open the relevant **`app/models/*.py`** (the source of truth) for exact columns.
> For a full, always-current SQL mirror of every table/index, see **`docs/schema.sql`** (generated —
> regenerate with `make schema` after any model/migration change). Two minutes there beats grepping
> the schema back together.
>
> **Need the endpoint list?** **`docs/api.md`** is an always-current map of every REST route
> (method · path · 🔒auth · handler, grouped by router) — generated from the live FastAPI app;
> regenerate with `make api` after any router change. Source of truth is still `app/routers/*.py`.

**When you finish a feature, update TRACKER.md (tick the item) and FEATURES.md.** These are the source of truth — keep them current so the next session starts informed.

## Project layout (split across two sibling repos)
```
HomeServerAPI/skylight-api/         ← YOU ARE HERE (backend)
MySkylight/MySkylight/              ← frontend app (Next.js 16 PWA)
MySkylight/docs/                    ← canonical PLAN/FEATURES/TRACKER
```

## Run & test (venv at `venv`)
Activate the venv first — macOS/Linux: `source venv/bin/activate`, Windows: `.\venv\Scripts\Activate.ps1` — then:
```bash
# run dev server
uvicorn app.main:app --port 8001 --reload
# tests (in-memory sqlite, mocked Clerk — see tests/conftest.py)
pytest
# migrations
alembic upgrade head   # then: alembic revision --autogenerate -m "..."
# regenerate the committed doc mirrors after a model/migration/router change:
make schema   # docs/schema.sql (also verifies the migration chain applies)
make api      # docs/api.md   (endpoint list from the live FastAPI app)
make docs     # both at once
```
(Common tasks are wrapped in the `Makefile`: `make test` / `migrate` / `schema` / `api` / `docs` / `run`.)
First-time setup (macOS/Linux): `python3 -m venv venv && source venv/bin/activate && pip install -e ".[dev]"`
(Windows: `python -m venv venv`, then `.\venv\Scripts\Activate.ps1`, then `pip install -e ".[dev]"`).
The `[dev]` extra installs pytest/pytest-asyncio/pytest-env — without it `pytest` errors with
"No module named pytest". On macOS use `python3` (there's no `python`); install via `brew install python@3.13`.
See the repo `README.md` for the full local-dev walkthrough.
Prod entrypoint: `alembic upgrade head` then `uvicorn app.main:app --host 0.0.0.0 --port 8001`.

## Deployment — automatic on push to `main` (do NOT hand-deploy the Pi)
A **push to `main` deploys itself.** `.github/workflows/deploy.yml` (in the **parent** `HomeServerAPI`
repo) SSHes into the Pi and runs `ops/deploy.sh skylight`, which `git reset --hard origin/main` then
`docker compose up -d --build skylight-api`. The container entrypoint (`entrypoint.sh`) runs
**`alembic upgrade head`** before uvicorn, so **migrations apply automatically on deploy** — never tell the
user to `git pull` / run `alembic` / `docker compose` on the Pi by hand. The deploy health-checks
`/api/v1/health` and **rolls the code back** (`git reset --hard` to the previous commit) on failure.
- After pushing, you can confirm with `gh run list -R DaymonH/HomeServerAPI` (look for "Deploy to Pi" =
  success).
- **Caveat:** rollback reverts *code* but **not** the DB — migrations are forward-only (our `downgrade()`s
  often just raise). Keep a migration safe even if the matching code rolls back.
- The **frontend deploys separately** (Netlify, on push to its `main`). When an API-contract change spans
  both repos, push them close together so the live FE/BE don't mismatch.

## Architecture essentials (the stuff that's always relevant)
- **Multi-tenancy:** `Family` is the tenant boundary; all core data is family-scoped.
- **Identity = Clerk, but the org model is OURS.** Clerk owns login/JWT only. Backend verifies Clerk
  JWTs via JWKS (networkless) → resolves to a local **`User`** (keyed by `clerk_user_id`, no password).
  Clerk **webhooks** (svix-verified) sync `User`. **`Family`, `Membership`, `Invitation`, roles live in our DB** — we did *not* use Clerk Organizations.
- **`User` ≠ `Member`.** `User` = a real Clerk login. `Member` = a calendar persona (a person shown on
  the calendar). Each `User` in a `Family` should have exactly **one** `Member`. Auto-created by
  `app/services/members.py::ensure_member_for_user` on family-create (owner) and invite-accept (F13).
- **Roles** per `Membership`: `owner` / `adult` / `child` / `viewer`.
- **Realtime:** SSE per-family bus (`app/services/realtime.py`) — emit typed events (`event.created`, `member.created`, …) on commit so devices live-update.
- **Scheduling:** APScheduler (`app/services/scheduler.py`) — weather-cache refresh; started in `main.py` lifespan, **skipped under tests**.
- **Recurrence:** RRULE via `python-dateutil` with per-occurrence overrides.

## Gotchas (hard-won — don't relearn these)
- **SQLAlchemy identity-map staleness:** use `populate_existing=True` on re-queries after a write in the
  same session, or you get stale rows. `AsyncSessionLocal` uses `expire_on_commit=False`.
- **SQLite:** needs `PRAGMA foreign_keys=ON` + WAL (wired in `app/core/database.py`).
- **SQLite can't `ALTER ... ADD COLUMN` with a foreign-key constraint** — alembic raises
  `NotImplementedError: No support for ALTER of constraints`. Either use `op.batch_alter_table(...)`
  (rebuilds the whole table — heavy, risky on the live Pi DB) **or** add a *bare nullable* column and
  keep the FK only in the model (the relationship works off model metadata; SQLite barely enforces
  added FKs anyway). We chose the latter for `Invitation.member_id` (migration `015`) since `Member`s
  are soft-deleted, so DB-level referential integrity buys little. Tests build the schema from
  `Base.metadata` (which *does* include the FK), so test vs. prod schema differ slightly here — fine.
  (Tired of these SQLite workarounds? A Postgres migration was evaluated & deferred —
  `docs/postgres-migration.md` has the trade-offs, the steps, and the triggers to revisit.)
- **Soft delete is everywhere** (`SoftDeleteMixin.deleted_at`): reads must filter `deleted_at.is_(None)`
  or you'll resurrect deleted rows. Rows are never physically removed — a "delete" is a timestamp.
- **FastAPI dep-override params must be typed** (e.g. `request: Request`), else FastAPI treats them as
  query params → 422. (Bit us in `tests/conftest.py`.)
- **`AsyncIOScheduler.shutdown()` is deferred** onto the event loop — completes on next tick. Correct, not a bug.

## Conventions
- **Never edit `.env`** or commit secrets. `.env`, `*.db`, `venv` are git-ignored. Test env vars are in `pyproject.toml [tool.pytest.ini_options]`.
- Routers in `app/routers/`, models `app/models/`, schemas (Pydantic v2) `app/schemas/`, business logic `app/services/`. REST under `/api/v1`.
- `ruff`, line length 100.
