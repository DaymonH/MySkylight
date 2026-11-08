# Auto-day chores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Weekly chores get their weekday chosen by the F30 balancer on save; the "Starts" field is replaced by "Starts immediately" / "Not before"; users can still pin specific days.

**Architecture:** The backend gains a persisted `day_pinned` flag and a `place_auto_day` service that runs the existing `compute_balance_plan` with all other chores as fixed background load, then writes only `rrule` + `start_date`. `create_task`/`update_task` call it. The frontend swaps the date field for the new controls and sends `day_pinned`.

**Tech Stack:** FastAPI + SQLAlchemy async + Alembic + pytest (backend); Next.js 16 + react-hook-form + zod + shadcn (frontend).

**Spec:** `docs/superpowers/specs/2026-11-08-auto-day-chores-design.md`

## Global Constraints

- **Backend work happens in the `HomeServerAPI` repo (`skylight-api/`), cloned at `/Users/daymonhansen/Github_Repos/HomeServerAPI`.** The `MySkylightBackend/` folder inside the MySkylight repo is a stale copy (stops at migration 019, no `icon`). Do not edit it.
- Latest live migration is `023`; the new one is `024`.
- Commit and push straight to `main` (no branches/PRs). Push **backend first**, wait for its GitHub Actions deploy to succeed, then push the frontend.
- Run `pytest` (backend) and `npx tsc --noEmit` + `npm run lint` (frontend, in `MySkylight/MySkylight/`) before each push.
- Auto-day covers only `FREQ=WEEKLY` rules with no `BYDAY` (weekly, every-N-weeks). Daily, monthly, every-N-days and multi-day weekly are never auto-placed.
- The date never picks the weekday: first occurrence = first chosen weekday on or after `max(today, not_before)`.
- One-off to-dos keep a required date (labelled "Due").
- Existing chores default to `day_pinned = false` (balancer behavior for them is unchanged).
- Tick the feature in `docs/TRACKER.md` and add an update under F01/F30 in `docs/FEATURES.md` (MySkylight repo).

## Review Focus

- A family with **no other chores** and an Auto weekly chore: placement still succeeds and yields a valid `BYDAY`.
- A chore with **no assignees**: still gets a weekday (members are only used to weigh load; assignments are never changed by placement).
- **`not_before` in the far future** (e.g. 2027-03-01) or an `UNTIL` earlier than the first occurrence: first occurrence is on/after `not_before`; no occurrences means the task is left as-is, no crash.
- **Every-2-weeks** Auto chore keeps `INTERVAL=2` and its first occurrence is on/after the anchor.
- **Editing only the title** of an Auto chore never moves its day.

---

### Task 1: `day_pinned` column, schema and migration

**Files (all under `HomeServerAPI/skylight-api/`):**
- Create: `alembic/versions/024_task_day_pinned.py`
- Modify: `app/models/task.py` (Task), `app/schemas/task.py` (`TaskCreate`, `TaskUpdate`, `TaskOut` + its `_from_orm` dict)
- Test: `tests/test_tasks.py`

**Interfaces:**
- Produces: `Task.day_pinned: Mapped[bool]` (default `False`); `TaskCreate.day_pinned: bool = False`; `TaskUpdate.day_pinned: bool | None = None`; `TaskOut.day_pinned: bool`.

- [ ] **Step 1: Write the failing test** `test_task_day_pinned_roundtrip`: create a task via `svc.create_task` with `TaskCreate(title="Trash", day_pinned=True, rrule="FREQ=WEEKLY;BYDAY=WE")`, assert `task.day_pinned is True`; create another without it, assert `False`; assert `TaskOut.model_validate(task).day_pinned` matches.
- [ ] **Step 2: Run** `pytest tests/test_tasks.py::test_task_day_pinned_roundtrip -v` → FAIL (unknown field).
- [ ] **Step 3: Implement** the model column (`Boolean`, `default=False`, `server_default=sa.false()`), the three schema fields, passing `day_pinned` through `create_task` and the `update_task` required-column loop (ignore `None`). Migration `024` adds the column with `server_default=sa.false()`, `down_revision = "023"`, bare `add_column` (SQLite-safe, like `018`).
- [ ] **Step 4: Run** the test → PASS; then `pytest -q` → all green.
- [ ] **Step 5: Commit** `feat(skylight-api): day_pinned flag on tasks` (do not push yet).

### Task 2: `place_auto_day` service

**Files:** Modify `app/services/tasks.py`; Test `tests/test_balance.py` (reuse its `_family_two`, `_weekly`, `TODAY = Mon 2026-07-06`).

**Interfaces:**
- Consumes: `compute_balance_plan`, `BalancePlanRequest`, `BalanceItemIn` (existing).
- Produces:
  - `def auto_day_eligible(task: Task) -> bool` — `not task.day_pinned`, `FREQ=WEEKLY`, no `BYDAY`.
  - `async def place_auto_day(task: Task, family_id: uuid.UUID, session: AsyncSession, *, not_before: date | None = None, today: date | None = None) -> bool` — returns `True` if it changed the task. Does not commit.

- [ ] **Step 1: Write failing tests** (each uses `today=TODAY`):
  - `test_place_auto_day_picks_empty_day`: Alex has a weekly chore pinned on Monday (`day_pinned=True`, `BYDAY=MO`, 30 min); place a new `FREQ=WEEKLY` chore for Alex → its `BYDAY` is not `MO`, and the Monday chore's `rrule` is unchanged.
  - `test_place_auto_day_no_other_chores`: empty family → returns `True`, `BYDAY` present.
  - `test_place_auto_day_no_assignees`: `member_ids=[]` → returns `True`, assignments still empty.
  - `test_place_auto_day_not_before`: `not_before=date(2027,3,1)` → `task.start_date >= date(2027,3,1)` and `task.start_date.weekday()` equals the chosen `BYDAY` weekday.
  - `test_place_auto_day_keeps_interval`: `FREQ=WEEKLY;INTERVAL=2` → result rrule contains `INTERVAL=2`.
  - `test_place_auto_day_ineligible_untouched`: daily rrule, pinned weekly, and monthly rrule each → returns `False`, `rrule`/`start_date` unchanged.
  - `test_place_auto_day_until_before_first_occurrence`: `UNTIL` earlier than `TODAY` → returns `False`, task unchanged.
- [ ] **Step 2: Run** `pytest tests/test_balance.py -k place_auto_day -v` → FAIL (not defined).
- [ ] **Step 3: Implement** both functions in `app/services/tasks.py`. Approach: if not eligible, return `False`. Set `anchor = max(today, not_before or today)`; set `task.start_date = anchor` first (the rrule phase and `_placements` expand from it). Build one `BalanceItemIn` (`minutes = task.estimated_minutes or _DEFAULT_MINUTES`; `mode="rotate"` when `assignment_strategy == rotating`, otherwise `"fixed"` with the first assignee; if there are no assignees use `"rotate"`). `member_ids` = the task's assignees, or all active family members when none. Call `compute_balance_plan(..., today=anchor)`; apply **only** `change.rrule` and `change.start_date`; never touch assignments or rotation fields. If there are no changes or no occurrences, restore the original `start_date` and return `False`.
- [ ] **Step 4: Run** the new tests → PASS; `pytest -q` → green.
- [ ] **Step 5: Commit** `feat(skylight-api): place_auto_day picks the lightest weekday for a new chore`.

### Task 3: Wire into create/update, regenerate docs, deploy

**Files:** Modify `app/services/tasks.py` (`create_task`, `update_task`); Test `tests/test_tasks.py`; regenerate `docs/schema.sql`, `docs/api.md`.

**Interfaces:**
- Consumes: `auto_day_eligible`, `place_auto_day` (Task 2).
- Produces: behavior — `create_task` calls `place_auto_day(task, family_id, session, not_before=data.start_date)` after the flush when eligible, then commits. `update_task` re-places only when the rrule **ignoring `BYDAY`** changed or `day_pinned` flipped from `True` to `False`; otherwise, for an eligible task whose incoming rrule lacks `BYDAY`, the stored rrule (with its `BYDAY`) is kept.

- [ ] **Step 1: Write failing tests:**
  - `test_create_auto_weekly_gets_weekday`: create `rrule="FREQ=WEEKLY"` without `start_date` → rrule has `BYDAY`, `start_date >= today`, weekday matches `BYDAY`.
  - `test_create_pinned_keeps_chosen_day`: `day_pinned=True`, `BYDAY=WE`, `start_date` = a Monday → `BYDAY=WE` preserved.
  - `test_update_title_only_does_not_move_day`: place, then update with `title="x"` and `rrule="FREQ=WEEKLY"` (what the form sends) → stored `BYDAY` unchanged.
  - `test_update_interval_change_replaces`: `FREQ=WEEKLY` → `FREQ=WEEKLY;INTERVAL=2` → rrule now has `INTERVAL=2` and a `BYDAY`.
  - `test_update_unpin_replaces`: pinned on `BYDAY=WE`, update `day_pinned=False, rrule="FREQ=WEEKLY"` → `day_pinned` false and `BYDAY` present.
- [ ] **Step 2: Run** them → FAIL.
- [ ] **Step 3: Implement** the wiring and a small `_strip_byday(rrule) -> str` helper (reuse `_parse_rrule_parts`/`_build_rrule`).
- [ ] **Step 4: Run** `pytest -q` → all green; run `make docs`.
- [ ] **Step 5: Commit and push** to `main` of `HomeServerAPI`; watch the GitHub Actions deploy (`gh run watch`) until it succeeds, then confirm `GET /health` on the Dell (per the HomeServerAPI deploy notes). **Do not start Task 4's push until this is green.**

### Task 4: Frontend form, payload and balancer default

**Files (under `myskylight/MySkylight/`):** Modify `lib/types/task.ts` (`day_pinned: boolean` on `TaskOut`), `components/tasks/task-sheet.tsx`, `app/app/family/[familyId]/tasks/page.tsx` (payload mapping), `components/tasks/balance-sheet.tsx:96` (`lockDay: t.day_pinned`).

**Interfaces:**
- Consumes: backend `day_pinned` on create/update/out (Task 1) and Auto placement (Task 3).
- Produces: `TaskFormValues` loses the required `start_date`; gains `starts_immediately: boolean` (default `true`), `not_before: string` (YYYY-MM-DD or `""`), `day_pinned: boolean`, and `due_date: string` (one-offs only). Submit payload rules: recurring → `start_date` is omitted when `starts_immediately`, else `not_before`; one-off → `start_date = due_date`; `day_pinned = true` only when the weekly rule has `BYDAY`.

- [ ] **Step 1: Types + schema:** update `schema` (`task-sheet.tsx:66`) with a `superRefine`: one-off requires `due_date`; recurring with `starts_immediately=false` requires `not_before`.
- [ ] **Step 2: Form UI.** Remove the "Starts" block (`task-sheet.tsx:331`). One-off (rrule `none`): show a "Due" date input. Recurring: show a **Starts immediately** checkbox (default on); unchecking reveals **Not before** (`min` = today). For weekly rules add a **Day** select: **Auto (balance)** (default) or **Pick days…** which reveals the existing weekday chips (this is today's "Custom days…" path; keep `bydayRrule`). Editing: when `day_pinned` is false, strip `BYDAY` from the weekly pattern shown/sent; when the task's `start_date` is in the future, show the box unchecked with `not_before` prefilled, else checked.
- [ ] **Step 3: Payload mapping** in the tasks `page.tsx` per the Produces rules above. Remove any remaining use of the old `start_date` form field (`startDate` watch at `task-sheet.tsx:222` now feeds `weekdayOf` from `not_before` or today).
- [ ] **Step 4: Balance sheet:** initialize `lockDay` from `t.day_pinned`.
- [ ] **Step 5: Verify:** `npx tsc --noEmit`, `npm run lint`, `npm run build` all pass. Then run the app locally (`/run` skill) against the live API and check: create a weekly chore on Auto (no date prompt, gets a weekday); create one with "Pick days… Wed" (stays Wed); edit it back to Auto (moves); a one-off still asks for "Due"; "Not before" in the future delays the first occurrence.
- [ ] **Step 6: Docs + commit:** tick the item in `docs/TRACKER.md`; add a dated update to `docs/FEATURES.md` under F01 and F30. Commit `feat(tasks): auto-pick the chore day; replace Starts with Starts immediately / Not before` and push to `main` **only after** Task 3's backend deploy is green.

---

## Self-review notes
- Spec coverage: Day control (Auto/pinned), Starts-immediately + Not before, daily/monthly start today, one-off Due, pinned = locked for the balancer, edit Auto↔pinned, backend-first push, docs ticks: each has a task above.
- Names used across tasks: `day_pinned`, `auto_day_eligible`, `place_auto_day`, `_strip_byday`, `starts_immediately`, `not_before`, `due_date`: consistent.
- Left to the implementer: exact optimizer item construction details inside `place_auto_day`; exact UI layout within the existing sheet.
