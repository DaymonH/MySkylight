# Auto-day chores (no start date) — short design

**Date:** 2026-11-08 · **Builds on:** F01 (Tasks), F27 (rotation), F30 (Chore Load Balancer)

## Intent
Creating a chore shouldn't require picking a start date, because today that date silently decides the
weekday. The user wants the app to choose the weekday that best balances the family's load, while still
letting them pin specific days (e.g. take the trash out the day before pickup).

## Goals
- On save, a recurring weekly (or every-N-weeks) chore gets its weekday chosen automatically.
- Pinning specific days stays possible, and a pinned chore can be released back to Auto when editing.
- No "Starts" date field. A **Starts immediately** checkbox (default on) replaces it; unchecking it reveals a
  **Not before** date.

## Non-goals
- Auto-day for monthly or every-N-days chores (they start today; can be extended later).
- Moving any existing chore when a new one is added.

## Behavior
- **Day control (weekly / every-N-weeks):** `Auto (balance)` (default) or Mon–Sun chips (existing
  "Custom days…"). Chips = pinned.
- **Save with Auto:** backend runs the F30 optimizer with all other chores held fixed, places only this
  chore on the lightest weekday (weighted by minutes and assignee), writes that weekday into the rrule.
- **Date rule:** the date never picks the weekday. First occurrence = first chosen weekday on or after
  today (Starts immediately) or on or after the "Not before" date. `start_date` stays in the data model
  as the computed anchor; it just isn't a user field.
- **Edit:** same Day control. Switching to Auto re-places that one chore (others fixed); choosing days
  re-pins it. Pinned chores are treated as `lock_day` in later balancer runs; Auto chores stay movable.
- **Daily chores:** no weekday to choose; start today (or "Not before").
- **One-off to-dos:** keep a plain "Due" date, since they have no schedule.

## Approaches considered
1. **Backend places on save using the F30 optimizer, others fixed** (chosen). Reuses existing logic,
   one source of truth, works from every client.
2. Frontend computes the weekday and sends it. Rejected: duplicates the optimizer in TypeScript.
3. Leave the date on today and wait for the user to run the balancer. Rejected by the user (wants no
   "which day?" step and immediate placement).

## Constraints
- Backend deploys on push to `main`; push backend first, wait for deploy, then frontend.
- Update `docs/TRACKER.md` and `docs/FEATURES.md` when done.
- Need a persisted "pinned vs auto" flag so the balancer can lock pinned chores (exact column is the
  builder's call; check what `lock_day` currently derives from).

## Left to the builder
- Where the place-one-chore function lives (`services/tasks.py` calling `chore_balancer.py`).
- Migration shape for the pinned flag, if one is needed.
- Tests: Auto picks the lightest day; pinned stays put; Not-before date; edit Auto↔pinned.
