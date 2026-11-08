# MySkylight — Feature Inventory & Specs

Every feature advertised on the Skylight Calendar site, mapped to our implementation. Each has a
stable **ID** (referenced by [TRACKER.md](./TRACKER.md)), our approach, the backend (BE) and
frontend (FE) pieces, and **acceptance criteria** (AC) that define "done".

**Legend:** ⭐ = Calendar Plus (paid) feature · 🔌 = external integration · 🤖 = AI (Gemini Flash-Lite)

---

## Foundational (not on Skylight's list, but required)

### F00 — Identity, Family & Authentication

- **Approach:** **Clerk** authenticates individual users (email/social/MFA/sessions). The backend is a
  resource server: it verifies the Clerk JWT (JWKS, networkless) and maps `clerk_user_id` → our `User`.
  Family = tenant; users join families via Membership with a role (`owner`/`adult`/`child`/`viewer`),
  all stored in **our DB** (not Clerk Organizations).
- **BE:** `User` (keyed by `clerk_user_id`, no password), `Family`, `Membership`, `Member` models;
  Clerk JWT-verification dependency; `GET /me`; `/webhooks/clerk` (Svix-verified `user.*`) + JIT
  provisioning; `/families`, `/members`; per-family authz dependency.
- **FE:** Clerk `<ClerkProvider>` + `clerkMiddleware`; `<SignIn>/<SignUp>/<UserButton>`; create-family
  wizard (post sign-in); profile switcher; Clerk session token attached to the API client.
- **AC:** A Clerk user signs in, creates a family, and is `owner`; the backend rejects any request with a
  missing/invalid Clerk JWT and any cross-family access.
- **Status (2026-06-14):** ✅ Phase 1 complete. The AC is now covered by automated tests —
  JWT verification (`tests/test_security.py`), webhook user-sync (`tests/test_webhooks.py`), and
  cross-family + role rejection (`tests/test_authz.py`); a hardening pass also made the Clerk webhook
  reject malformed (non-base64) signatures with 400 instead of 500. **Profile switcher** shipped as a
  member-avatar filter (`components/calendar/member-filter.tsx` + `hooks/use-active-member.ts`) on both
  `/device` and `/app`. The multi-**family** switcher for co-parents (User in >1 family) stays deferred —
  the app still uses `memberships[0]`.

### F23 — Calendar & Events Engine

- **Approach:** The core CRUD + recurrence engine underneath all calendar features.
- **BE:** `Event`, `EventAssignment`, `Reminder`; RRULE recurrence with per-occurrence
  overrides (this/following/all); `/events`, `/events/{id}/occurrences`.
- **FE:** Event create/edit sheet (title, time, all-day, location, repeat, members, reminder, color).
- **AC:** Create/edit/delete single + recurring events; "edit this occurrence only" works; reminders persist.
- **Update (2026-11-07) — per-occurrence edit/delete in the UI (BE + FE):** the backend already
  supported this/following/all, but the sheet always sent "all". Saving a repeating event now asks
  **This event / This and following / All events** (`ScopePicker` in `event-sheet.tsx`); deleting offers
  **This event** (cancels just that date) or **All**. "This event" is disabled once you've changed who's
  assigned, reminders, repeat or all-day — those are series-wide and the backend ignores them per-date.
  **Also fixed a data-loss bug:** "all" used to write the clicked occurrence's start onto the series, so
  editing a title from a later week moved the series' start and dropped every earlier occurrence. The
  client now sends `occurrence_start_dt`, and `_anchor_all_edit_to_series` shifts the series by the
  occurrence's delta instead (tests in `tests/test_calendar.py`).
- **Status (2026-06-20):** Removed the local `Calendar` container (migration `012`, "Model B"). Native
  events belong to the family and are colored by their assigned member (fallback `DEFAULT_EVENT_COLOR`) —
  there's no "choose a calendar" step. Synced events reference their source via `Event.external_calendar_id`
  and take that `ExternalCalendar`'s color; occurrences hide events whose source is toggled off
  (`ExternalCalendar.synced`).
- **Update (2026-06-28) — event source labeling (explains apparent "duplicates"):** Each `OccurrenceOut`
  now carries a `source` object (`EventSource`: `kind` local/external · `label` · `provider` · `account_email`)
  built in `services/calendar.py::get_occurrences` (batch-loads the `ExternalAccount` behind any mirrored
  calendar; no migration — pure serialization). **Why:** the read-only mirror engine dedups only *within*
  one external calendar (`apply_mirror_events`, key `<provider>:<cal>:<id>`), so the *same* real-world event
  can exist as several `Event` rows at once — typed into MySkylight **and** mirrored from Google **and** from
  iCloud — and all render (a recurring one shows N× per day). That's expected, not a bug; users had no way to
  tell the copies apart. The FE event details sheet (`components/calendar/event-sheet.tsx`) now names the
  origin: read-only mirrors show "**Synced from _{calendar}_ · {Provider}**" + the connected account email and
  a note that the event may also exist elsewhere; native events show "**Added in MySkylight**". `tsc` +
  `next build` + eslint clean; new `tests/test_calendar.py::test_occurrence_source_labels_native_vs_external`
  (suite **157 green**). _Follow-up if the duplicates themselves are unwanted: cross-source dedup/merge by
  title+time, or a per-calendar "hide" toggle — deliberately **not** done here (labeling only)._

### F24 — Realtime live-update

- **Approach:** Server pushes typed change events per family via **SSE**; clients reconcile TanStack Query cache.
- **BE:** `GET /api/v1/stream` SSE endpoint + in-process broadcast bus; emit on every mutating route.
- **FE:** Subscription hook (`useSSE`) that invalidates/patches the TanStack Query cache on each event.
  - **iOS caveat**: SSE connections drop when the PWA is backgrounded. The hook must reconnect on
    `visibilitychange` (document becomes visible). TanStack Query's `refetchOnWindowFocus` covers the
    data gap until the SSE reconnects.
- **AC:** An edit on the phone reflects on the device within ~1s without manual refresh; updates resume after backgrounding.
- **Status (2026-06-14):** ✅ Phase 2 closed. `hooks/use-realtime.ts` now reconnects on `visibilitychange`
  (foreground) and `online` — addressing the iOS-background drop above — and resyncs every family-scoped
  query (`occurrences`/`calendars`/`members`/`family`/`me·memberships`) on each *re*connect to catch up on
  events missed while disconnected. The first connect skips the resync (page data is already fresh). A
  transient drop is left to the browser's own retry; only a `CLOSED` stream triggers a manual reconnect.
  Remaining: a live two-device latency smoke is the final AC sign-off.
- _Phase 0 (scaffold) → Phase 2 (full)_

---

## Standard / Free features

### F01 — Tasks Manager

> _"Encourage kids' independence and healthy habits with a fun, interactive checklist for daily routines and chores."_

- **Approach:** Tasks/chores assignable to members, optionally recurring, grouped into **Routines**
  (e.g. "morning", "bedtime"). Big, satisfying checkable UI on the device. The device board shows
  **daily habits (routines) and one-off chores together** in one per-member view so nothing is missed
  (parity with Skylight's "unified Task/Routine view"). _Auto-rotating assignment is **F27**._
- **BE:** `Task`, `Routine`, `TaskCompletion` (per-occurrence); `/tasks`, `/routines`,
  `/tasks/{id}/complete`. Recurrence reuses the RRULE engine.
- **FE:** Per-member checklist cards on device + management in `/app`; completion animation.
- **AC:** Assign a recurring chore; child checks it off on device; resets next day; streak counts.
- **Status (2026-06-14):** ☑ Phase 3 complete (full stack). Backend **complete & tested** (8 tests in `tests/test_tasks.py`, suite
  39 green). Models `Task`/`Routine`/`TaskAssignment`/`TaskCompletion` (migration `003`); date-based
  recurrence anchored at `start_date` (reuses dateutil RRULE; one-off = no rrule); endpoints under
  `/families/{id}/routines` + `/families/{id}/tasks` incl. `…/tasks/occurrences?from&to`,
  idempotent `POST/DELETE …/{task_id}/complete`, and `GET …/{task_id}/streak?member_id`. Roles: owner/adult
  manage definitions; **children may check off, viewers may not**. Realtime emits `task.*`/`routine.*`.
  Completions key on `(task, member, occurrence_date)` so each new day resets naturally; streak lets a
  still-pending "today" slide without breaking the run.
  **FE now built:** device chore board at `/device/chores` (per-member cards, routine grouping, optimistic
  completion + check-pop/strikethrough, plus a Calendar/Chores kiosk nav), `/app` task & routine management
  (`app/app/family/[familyId]/tasks`) with a routine builder and per-member streak badges, and
  `task.*`/`routine.*` SSE wiring (`hooks/use-realtime.ts`). Build + typecheck + 39 backend tests green;
  live two-device smoke pending. One backend tweak: `update_task` now honours explicit nulls so a task can
  be moved out of a routine or have its rrule/notes cleared. **Not pushed yet** (HomeServerAPI auto-deploys on push).
- **Update (2026-06-21) — custom recurrence days (FE):** the task sheet's **Repeat** control now offers
  **"Custom days…"**, revealing Mon–Sun weekday chips that assemble a `FREQ=WEEKLY;BYDAY=…` rrule (e.g.
  "deep clean the bathroom" on **Tue + Sat**). The backend already accepted arbitrary `BYDAY` via
  `rrulestr`; this just surfaces it. `describeTaskRrule` reads custom sets back as e.g. "Tue, Sat".
  Decoupled rotation cadence (F27) layers on top unchanged — a twice-weekly chore can still rotate per
  occurrence / weekly / monthly. FE-only; `lib/recurrence.ts` + `components/tasks/task-sheet.tsx`.
  Typecheck clean.
- **Update (2026-06-25) — week view, missed/overdue, and filters (FE, both surfaces):** the chore
  experience now answers "what day / who / what's overdue" directly. Both the **device kiosk**
  (`components/tasks/chore-board.tsx`) and a **new companion view** (`/app/family/[familyId]/chores`,
  `components/tasks/chores-panel.tsx`) gained: a **Today / Week** toggle (week adds a Sunday-aligned day
  strip with per-day done/total — matches the calendar's week start), a persistent **"Missed"** section
  surfacing un-done chores from earlier days (14-day lookback, computed *before* the active window so
  within-week misses live in the day strip, not double-counted), and a shared **filter bar**
  (`components/tasks/chore-filter-bar.tsx`) covering **completion status (All / To do / Done) · person ·
  routine · frequency**. Frequency is bucketed from the task rrule by `classifyFrequency` in
  `lib/recurrence.ts`; all filter/overdue/date logic is pure in `lib/chores.ts`. **Bug fixed:** the board
  hard-coded completion to *today* — it now completes against each occurrence's real date, so a missed
  Tuesday chore checks off against Tuesday (required for the Missed section + week view to work). The
  companion `FamilyMenu` now links **Chores** (the do/check view) separately from **Manage tasks** (the
  CRUD page). No backend change — `GET …/tasks/occurrences?from&to` already served arbitrary ranges.
  `next build` + typecheck + eslint clean; 25 backend task tests still green. Live two-device smoke pending.
- **Update (2026-11-08) — emoji, "Do it tomorrow", all-done celebration (BE + FE):**
  - **Per-chore emoji:** `tasks.icon` (migration `021`); a picker in the task editor
    (`components/tasks/icon-picker.tsx`, quick-pick grid + type-any-emoji) and the emoji renders on the
    kiosk board, week grid, phone list and task list. `occurrences` carry `icon`.
  - **"Do it tomorrow":** a row menu action that pushes *just that occurrence* to a later day without
    re-phasing the series (unlike "Move to today"). `PUT/DELETE
    /families/{id}/tasks/{task}/occurrences/{date}/move`, table `task_occurrence_moves`. The original
    date shows nothing and the new date shows the chore ("Moved from Tue"); completion and stars key to
    the new date; a rotating chore keeps its original assignee; the streak treats the original date as
    excused. Missed rows say "Do it today (just once)". Hidden for daily chores (tomorrow already has one),
    refused if already done or the day is taken, ≤30 days out, owner/adult only, with an Undo toast.
  - **All-done celebration:** confetti over a person's card + "All done — nice work!" the moment they tick
    their last chore (`components/tasks/all-done-celebration.tsx`); not on page load, silent for
    reduced-motion.
  - **Overlap warning (calendar):** the event sheet warns when a selected person is already on an
    overlapping timed event (`lib/event-conflicts.ts`). Warning only — it never blocks saving — and
    limited to the events loaded for the visible range.
- **Update (2026-11-07) — star feedback on the wall display:** the kiosk chore rows showed no star value
  (the phone list already did). Rows now show **★ N**, completing a chore floats a **+N ★**
  (`components/tasks/star-pop.tsx`, respects reduced-motion), and each person's card header shows their
  **available star balance** (`useStarBalances`, kept live by the `task.*`/`reward.*` SSE events).
- **Update (2026-11-07) — Missed list no longer piles up: auto-expire + "Clear" (BE + FE):** the Missed
  section used to list every un-done chore from the last 14 days, and the only way to empty it was to tick
  each row — which *awarded stars* for chores nobody did. Now (1) **missed chores expire by cadence**
  (`withinMissedWindow` in `lib/chores.ts`: daily 1 day, weekly 7, monthly/one-off 30), and (2) a **Clear**
  button on the Missed header (owner/adult, both surfaces; `components/tasks/clear-missed-button.tsx`)
  dismisses everything up to the section's anchor in one tap behind a confirm, with an **Undo** toast.
  **Clearing is not completing — no star is awarded** and streaks still see the miss. Backend:
  `PUT /families/{id}/missed-chores {through}` sets `families.missed_cleared_through` (migration `020`,
  strictly before the household's today; `null`/earlier restores); occurrences carry `is_dismissed`.
- **Update (2026-07-14) — "Move to today": re-phase a missed chore's cadence (BE + FE):** fixes the
  "did the every-other-day chore today but it still wants tomorrow" problem. A chore's recurrence is a
  pure function of `start_date` + `rrule`, so a missed occurrence's next instance stayed locked to the
  original schedule. New backend endpoint **`POST /families/{id}/tasks/{id}/move-to-today`**
  (`move_task_to_today` in `app/services/tasks.py`) **re-anchors `start_date` to today** so the whole
  future series re-phases from today (e.g. every-other-day → today, +2, +4…). It preserves the rotation
  phase for week/month rotations (pins `rotation_anchor_date` to the old start when unset) and, given a
  `member_id`, also records today's completion via the existing idempotent `complete_task`. Guards (400):
  only recurring, **interval-style** chores — rejects one-offs, `BYDAY=`/`BYMONTHDAY=` (calendar-pinned),
  and an already-past `UNTIL`. **FE:** a **Move to today** item in the chore-row 3-dot menu on both the
  device board (`components/tasks/chore-board.tsx`, incl. the week grid — from the Missed section it's
  one tap that also completes today for that member) and the companion panel
  (`components/tasks/chores-panel.tsx`, re-phase only — its rows group all assignees). Gated by
  `canRephase(rrule)` (`lib/recurrence.ts`) and hidden on a today occurrence; hook `useMoveTaskToToday`
  (idempotent → `RETRY_TRANSPORT`). Original-day backfill (tapping a Missed row) is unchanged. Backend
  tests in `tests/test_tasks.py` (re-phase, rotation-anchor preservation, the three guards, API path);
  full suite (198) + `tsc`/eslint green. No migration (only existing columns mutated).
- **Update (2026-06-29) — device chore board: time buckets, week paging, full-week grid (FE):** three
  refinements to `components/tasks/chore-board.tsx`. **(1) Time bucket on each card** — every chore row
  (today cards, Missed rows, and the week grid) now shows a ⏱ chip with its F30 estimate via `bucketLabel`;
  occurrences don't carry `estimated_minutes`, so it's joined client-side from `useTasks` (no BE change).
  **(2) Week paging** — a `weekOffset` with ◀ / ▶ and a "This week" reset lets the week view show future
  (and past) weeks; the **Missed** section is gated to today / the current week only (a future week has
  nothing to miss yet, so its overdue query is disabled). **(3) Real week view** — replaced the
  tap-a-day-tab behavior (which felt like a scrollable daily view) with a **7-day grid** (`WeekGrid` /
  `WeekDayColumn`): every day shows at once as a column with a per-day done/total header and compact
  tap-to-complete rows (`WeekChoreRow`, one per assignee, the colored initials box doubling as checkbox +
  who-cue). Each rotating row keeps the **3-dot swap/skip/reset menu** (same affordance as the Today view);
  `weekRangeLabel`/`relativeWeekLabel` added to `lib/chores.ts`. FE-only; `tsc` + eslint clean.
- **Update (2026-06-25) — richer task editor (FE):** closed five gaps between the `Task` model and what the
  editor exposed. **(1) Color** — a swatch picker (`MEMBER_COLORS`, + "Auto" = inherit the assignee's
  color) wired to the long-unused `Task.color`. **(2) End date** — an optional "Ends" date on recurring
  chores, spliced into the rrule as `UNTIL=YYYYMMDD` (kept date-form so it stays naive-compatible with the
  backend's `start_date`-anchored DTSTART; verified inclusive against dateutil). **(3) Every N
  days/weeks/months** — one "Custom interval…" mode (number + unit) replacing the days-only control, →
  `FREQ=DAILY|WEEKLY|MONTHLY;INTERVAL=N`. **(5) Manual task ordering** — ↑/↓ buttons on each task row write
  sequential `sort_order` (drag still deferred, like the roster/list reorders). **(6) Rotation anchor
  date** — exposes `rotation_anchor_date` for calendar-based cadences (re-phase a week/month rotation
  without moving the start). The editor now splits the stored rrule into *pattern* + *end date* and
  recombines on save; `describeTaskRrule` reads back "Every N weeks · until Jul 10". Helpers consolidated in
  `lib/recurrence.ts` (`intervalRrule`/`parseInterval`/`isCustomInterval`, `withUntil`/`parseUntil`/`stripUntil`).
  No backend change (model already had every field). `next build` + tsc + eslint clean.
- **Future (F01 backlog):**
  - ~~**Per-chore icon / emoji**~~ — **done 2026-11-08** (see the update below).
  - **Chore reminders & overdue nudges** — push/notify when a chore is due or has been missed (e.g. morning
    "your chores" ping, evening "still undone" nudge). Belongs with the Phase 9 notifications track (Web
    Push; reuse the Event `Reminder` plumbing). Backend would schedule per-occurrence; FE needs the PWA
    push opt-in. (BE + FE, larger.)
  - **Parent approval / proof on completion** — optional gate so a kid's check-off needs a parent confirm
    (and/or a photo). Touches the completion model + rewards (stars on approval). (BE + FE.)
- _Phase 3_

### F02 — Color Coding

> _"Assign each family member their own color…"_

- **Approach:** Each `Member` has a color; events/tasks inherit it. Resolution: event override →
  member → calendar.
- **BE:** `color` on `Member`/`Calendar`/`Event`; resolved server-side helper.
- **FE:** Color picker in member setup; color-keyed legend + dots/bars across all views.
- **AC:** Each member shows a distinct color everywhere; multi-assignee events show all colors.
- _Phase 1–2_

### F03 — Mobile App

> _"Manage and access everything on your Skylight from anywhere…"_

- **Approach:** Responsive `/app` surface — the same PWA used for the wall screen, just a different
  route optimised for portrait/mobile. Installable to the home screen; works offline for the cached shell.
- **BE:** n/a (shared API).
- **FE:** Mobile layouts; PWA manifest + service worker already in place.
  - **Android**: `beforeinstallprompt` → show native "Install app" banner/button.
  - **iOS**: no install prompt API — show an in-app tooltip ("Tap Share → Add to Home Screen") when
    `navigator.standalone === false` and the user-agent is iOS Safari. Detect install via `navigator.standalone`.
  - Offline shell loads without network; last-fetched data visible from TanStack Query cache.
- **AC:** Installable on Android (prompted) and iOS (manual); full create/edit from mobile; offline shell loads.
- _Phase 0 (shell) → all phases_

### F04 — Custom Lists

> _"Streamline and manage tasks, to-dos, and groceries with lists the whole family can access…"_

- **Approach:** Named lists (to-do / grocery types), shared family-wide, check/uncheck items.
- **BE:** `List`, `ListItem` (text, qty, category, checked, assignee); `/lists`, `/list-items`.
- **FE:** List screens on device + mobile; quick-add; swipe/tap to check; reorder.
- **AC:** Create a grocery list; both surfaces see live edits; checked items move/strike.
- **Status (2026-06-15):** ☑ Full-stack done. **BE** (`app/models/list.py`, `schemas/list.py`,
  `services/lists.py`, `routers/lists.py`, migration `005`): `List` (todo/grocery) + `ListItem`
  (free-text `quantity`, `category`, `is_checked`/`checked_at`, optional `assignee` member). Endpoints
  are **family-scoped & nested** — `/families/{id}/lists` and `…/lists/{id}/items` (+ `…/reorder` on
  both, setting `sort_order` by index) — matching the events/tasks pattern rather than a top-level
  `/list-items`. Roles: owner/adult manage lists; **owner/adult/child** add/check/edit items, viewers
  read-only. Emits `list.*` (list- and item-level). Tested in `tests/test_lists.py` (7 tests; suite 62
  green). **FE:** mobile management at `app/app/family/[familyId]/lists` (list chips + create, quick-add,
  check/uncheck with optimistic cache patch, category grouping, completed section, per-item edit sheet
  for qty/category/assignee) and a glanceable device board `components/lists/list-board.tsx` at
  `/device/lists`; `list.*` wired into `hooks/use-realtime.ts`; linked from `FamilyMenu` + `DeviceNav`.
  `tsc` + `next build` clean. **Deferred:** FE drag-reorder (backend reorder endpoints exist); live
  two-device smoke is the final sign-off.
- _Phase 4_

### F05 — Grocery Shopping (Instacart) 🔌 — ❌ DESCOPED

> _"Add all items from your Grocery List to an Instacart order in just 2 taps. (US only)"_

- **Status (2026-06-15):** ❌ **Descoped — will not be built.** The owner doesn't use Instacart, so the
  hand-off (and its research spike) is dropped, not deferred. F04 grocery lists are the end of the
  grocery flow; **F28** (recipe → grocery aggregation) still writes into an F04 grocery `List`, it just
  no longer pushes anywhere external. Kept here for traceability against Skylight's feature list. If ever
  revived: Instacart's API is partner-gated/US-only, so the realistic path is a deep-link/affiliate
  "create cart" URL behind a region flag.
- _~~Phase 4~~ — removed from scope._

### F06 — Customized Views

> _"Toggle between day, week, month, and schedule views."_

- **Approach:** Four touch-friendly calendar views sharing one data layer; per-device default view.
- **BE:** Occurrence expansion endpoint with date-range params.
- **FE:** Day / Week / Month / Schedule(list) components; view toggle; remembers per-device choice.
- **AC:** All four views render the same events correctly, including recurring + all-day.
- **Update (2026-11-08) — drag to move and resize events (FE only):** in the Day and Week grids, drag a
  timed event to move it (Week: onto any day) or drag its bottom edge to resize it, snapped to 15 min and
  kept inside the visible hours (`hooks/use-event-drag.ts`, maths in `lib/event-drag.ts`). A press only
  becomes a drag after 6 px of travel, so a plain tap still opens the editor; Esc cancels. Saves once, on
  release, with an **Undo** toast. **Repeating events** ask *This event / This and following / All* first
  (the same picker as the editor, now `scope-picker.tsx`), and can only be dragged *within their day* — a
  single occurrence of a series hopping to another day is awkward (its series is anchored to a
  weekday/date), so changing the day goes through the editor. Not draggable: all-day, multi-day, and
  read-only synced events. **Touch:** finger-dragging is enabled **only on the wall display** (whose grid
  fits the screen and doesn't scroll); on the phone a finger on an event still scrolls the grid, so drag is
  mouse/pen-only there. Not yet exercised on real hardware — see the PR description for what to try.
- **Update (2026-11-07):** **tap an empty spot in the Day/Week grid to create an event at that time**
  (snapped to 30 min); on phone the grid **opens scrolled to "now"**. The wall display now **rolls over
  at midnight on its own** — the calendar anchor, countdown window, chore board and phone chores panel
  all follow `useTodayYMD()` (`hooks/use-today.ts`) instead of computing "today" once per render
  (freshness is SSE-only, so nothing used to happen at midnight). Navigating pins the date until "Today".
- _Phase 2_

### F07 — Weather

> _"Precise weather forecasting for the exact time and location of your events."_

- **Approach:** Fetch + cache forecasts by location; show conditions on day/event. Pluggable provider
  (Open-Meteo free default; swappable).
- **BE:** Weather client + `WeatherCache`; scheduled refresh; `/weather?location&date`.
- **FE:** Weather strip on day/week header; per-event weather when location + time known.
- **AC:** Today's hourly forecast shows on the device; an event with a location shows its forecast.
- _Phase 2_

### F08 — Event Countdowns

> _"Build excitement for birthdays, vacations, holidays, and more."_

- **Approach:** Mark an event as a countdown; device shows "N days until …" tiles.
- **BE:** `Countdown` (or flag on `Event`); `/events` returns countdown metadata.
- **FE:** Countdown widget on device home; "days until" on event detail.
- **AC:** Flagging an event surfaces an accurate live-updating countdown tile.
- _Phase 2_

### F09 — Sleep Mode

> _"Ensure your Skylight screen sleeps and wakes at the same time each day."_

- **Approach:** Per-device on/off schedule stored on the backend; the `/device` PWA polls the
  schedule and toggles sleep state client-side.
- **BE:** Sleep schedule on `Device` settings; scheduler emits `device.sleep`/`device.wake` SSE events;
  `/devices/{id}/settings`.
- **FE:**
  - **Active hours**: acquire **Web Wake Lock API** (`navigator.wakeLock.request("screen")`) so the
    screen stays on without OS timeout.
  - **Sleep time**: release the wake lock + show a sleep overlay (black screen or clock).
  - **Wake time**: dismiss the overlay + re-acquire the wake lock.
  - Settings UI in `/app` to configure the schedule.
  - Note: wake lock is released automatically by the browser when the PWA is backgrounded; re-acquire it
    on `visibilitychange` when the app returns to foreground during active hours.
- **AC:** Device screen stays on during active hours; goes to sleep overlay at the set time; wakes on schedule; configurable per device.
- _Phase 8_

### F12 — Device Linking

> _"Connect multiple Calendars across rooms (or even households!) so they share information."_

- **Approach:** A "device" is the MySkylight PWA running at `/device` in **standalone mode** on any
  hardware — a wall-mounted tablet, an old laptop, a Raspberry Pi with a touch display. No special OS
  or hardware required. Pair it to a family via a short code; the device receives a long-lived device
  token (not a Clerk session) so it stays logged in without a personal user account. Multiple screens
  can be paired to one family; a screen can be linked to multiple families (co-parenting).
- **BE:** `Device` model + device-scoped token; pairing-code issue/redeem; `/devices/pair`.
- **FE:** Pairing screen at `/device/pair` (display or enter code); device list + management in `/app`.
- **AC:** Two screens paired to one family stay in sync; unpair works; cross-household link supported.
- _Phase 8_

### F13 — Share Access

> _"Invite your spouse, co-parenting partner, kids, and close friends to access your Calendar."_

- **Approach:** Our own email/link invitations to join a family with a chosen role. The invitee
  authenticates with **Clerk**, then the accept flow creates a `Membership` linking their `User` to the
  `Family` **and auto-creates their `Member` persona**, seeded from their Clerk profile (name, avatar,
  and the next distinct colour in the palette) so they appear on the shared calendar immediately. An
  optional onboarding step lets them rename/recolour that persona. Co-parenting is supported: a `User`
  can belong to multiple families via separate `Membership` rows, with a family switcher in the app.
- **Key concept:** A `User` (Clerk login / credentials) is distinct from a `Member` (calendar persona).
  Each `User` in a Family has exactly one `Member` representing them on the calendar. Kids can be
  `Member`s without having a `User` login at all.
- **BE:** `Invitation` model, `/invitations` (create/accept/revoke), role assignment; `Member` auto-created
  on invite accept (idempotent; `ensure_member_for_user` — the owner's persona is created on family-create
  the same way); family-switcher support on `/me`.
- **FE:** Invite UI (role picker + optional pre-fill name), pending invites list, accept-invite landing →
  member onboarding step (name/color/avatar); family switcher in app header.
- **AC:** An invited person signs in, creates their member profile, and immediately sees the shared family
  calendar; their events/tasks are color-coded to them; revoke removes both Membership and access.
- **Status (2026-06-14):** ✅ FE invite flow built. Because this self-hosted setup has **no email server**,
  invites are **link-based**: `InvitationOut` now returns the `token`, and the inviter copies a
  `/invite/accept?token=…` link to share out-of-band. Surfaces: `app/app/family/[familyId]/invitations`
  (create with role picker, pending list, copy-link, revoke — owner/adult only) and the public
  `app/invite/accept` landing (prompts sign-in/up, then auto-accepts). Reached via a new `FamilyMenu` in
  the app header (Members + Invitations). Backend lifecycle covered by `tests/test_invitations.py`, which
  also caught + fixed an expiry-check bug (SQLite returns `expires_at` tz-naive → `TypeError` on every
  accept). **Deferred:** optional rename/recolour step on accept (BE auto-creates the persona, so the
  landing is intentionally thin); multi-family switcher in the header (currently uses `memberships[0]`).
- **Enhancement (2026-06-25) — link an invite to an existing profile (claim-on-accept):** You can
  pre-create a login-less `Member` (e.g. a spouse) and assign them chores, then later give them a login
  **without losing those assignments or reassigning anything**. `Invitation` gained a nullable `member_id`
  (migration `015`). When set, `create_invitation` validates the target is a live, **unclaimed** member of
  the family; on accept, instead of `ensure_member_for_user` spawning a duplicate, the existing persona is
  **claimed** (its `user_id` is set) so every `TaskAssignment` (and completion) carries over untouched —
  `Member.id` never changes. Falls back to the default new-persona behaviour when `member_id` is null, the
  target was already claimed, or the user already has a persona in the family. FE: invite form gains a
  "Link to existing profile" picker (unlinked members only); pending invites show a "Links to <name>" badge.
  Covered by new cases in `tests/test_invitations.py` (incl. a test proving chore assignments survive).
- _Phase 1_

---

## Calendar Plus features ⭐

### F14 — Rewards ⭐

> _"Motivate kids to finish tasks with star-powered incentives."_

- **Approach:** Completing tasks awards **stars**; a reward catalog lets kids redeem stars (with
  parent approval).
- **BE:** `Reward`, `StarBalance`, `Redemption`; award hook on `TaskCompletion`; `/rewards`,
  `/rewards/redeem`.
- **FE:** Star balance per child, reward shop, redeem + approve flow, celebratory UI.
- **AC:** Finishing a chore adds stars; redeeming deducts them and notifies a parent for approval.
- **Status (2026-06-15):** ☑ Full-stack done. **BE** (`models/reward.py`, `schemas/reward.py`,
  `services/rewards.py`, `routers/rewards.py`, migration `007`): `Reward` catalog + `Redemption`
  (pending→approved/rejected, `star_cost` snapshot). **Star balance is computed, not stored** —
  `earned` sums `TaskCompletion.stars_awarded` (a snapshot of `Task.star_value` taken in
  `complete_task`, so undo removes the stars and later edits don't rewrite history); `spent` =
  approved redemptions; **pending reserves** stars so they can't be double-spent
  (`available = earned − spent − pending`). Endpoints: `/rewards` CRUD (owner/adult),
  `…/rewards/{id}/redeem` (owner/adult/**child**, validates available ≥ cost), `…/star-balances`,
  `…/redemptions?status=`, `…/redemptions/{id}/approve|reject` (owner/adult). Emits `reward.*`. 6 tests
  in `tests/test_rewards.py` (suite 72 green). **FE:** `/app/family/[id]/rewards` (balance chips,
  parent approval queue, reward shop with a redeem member-picker + celebratory toast, catalog editor
  `reward-sheet.tsx`) and a device board `reward-board.tsx` at `/device/rewards`; task editor gains a
  "Stars for completing" field and the chore board/task list show ⭐ values; `reward.*`/`task.*` wired
  into `use-realtime.ts`. `tsc` + `next build` clean. **Deferred:** live two-device smoke.
- _Phase 5_

### F15 — Meal Planning ⭐

> _"Plan breakfast, lunch, dinner, snacks and add them to the calendar… upload/input recipes, create new ones with Smart tech."_

- **Approach:** Weekly meal grid (4 slots/day) referencing recipes or free text; planned meals can
  surface on the calendar. Recipe library with manual entry/upload; **AI generation + import from a
  URL or photo** in F17/Phase 6. Recipes carry **structured ingredients (qty/unit/name)** so a meal
  plan can be turned into an aggregated grocery list — see **F28**.
- **BE:** `MealPlan`, `Recipe` (+ `RecipeIngredient`); `/mealplans`, `/recipes`; option to project meals as calendar items.
- **FE:** Weekly meal planner board, recipe library + detail, "add to calendar".
- **AC:** Assign dinner for a week; recipes saved/edited; meals optionally show on the calendar.
- **Status (2026-06-15):** ☑ Full-stack done (with **F28**). **BE** (`app/models/meal.py`,
  `schemas/meal.py`, `services/meals.py`, `routers/meals.py`, migration `008`): `Recipe` +
  structured `RecipeIngredient` (qty `float|null`, unit, name), and `MealPlan` (date + `MealSlot`
  enum breakfast/lunch/dinner/snack, referencing a recipe **or** free-text `title`). Endpoints are
  family-scoped: `/families/{id}/recipes` (CRUD; an update replaces the whole ingredient set),
  `/families/{id}/mealplans?from&to`, and `…/mealplans/{id}/to-calendar` which **projects a meal onto
  the calendar** (per-slot default time; re-projecting updates the same event via a soft
  `calendar_event_id` link instead of duplicating). Roles: owner/adult manage; viewers read-only.
  Emits `recipe.*` / `mealplan.*`. **FE:** `app/app/family/[familyId]/meals` — a tabbed surface with a
  **weekly planner board** (prev/next week, per-day breakfast/lunch/dinner/snack rows, add-meal dialog
  picking a recipe or free text, per-meal "add to calendar"/remove) and a **recipe library** (cards +
  `components/meals/recipe-sheet.tsx` editor with dynamic qty·unit·name ingredient rows). A glanceable
  device board `components/meals/meal-board.tsx` at `/device/meals`. `recipe.*`/`mealplan.*` wired into
  `use-realtime.ts`; linked from `FamilyMenu` + `DeviceNav`. 9 backend tests (`tests/test_meals.py`,
  suite **81 green**); `tsc` + `next build` clean. **Deferred:** AI recipe gen + **photo/URL import via
  Gemini 3.1 Flash-Lite** land with Phase 6 (F17 — see PLAN §2 D3); live two-device smoke.
- _Phase 5 (AI recipe gen lands with Phase 6)_

### F16 — Photo Screensaver ⭐ — ⏸ PARKED (kept for later)

> _"Display favorite photos when idle… organize into albums to choose what's featured."_

- **Approach:** Upload photos into albums; when the device is idle, run a slideshow from selected
  albums. Albums mark which are "featured".
- **BE:** `Album`, `Photo`, file storage + thumbnails; `/albums`, `/photos` (upload).
- **FE:** Album manager + uploader in `/app`; idle-detection slideshow on `/device`.
- **AC:** Upload to an album, mark featured; device idle → smooth slideshow of those photos.
- **Status (2026-06-15):** ⏸ **Parked — not in the current build.** The owner chose to defer it;
  the spec is kept here in case it's added much later. It's the **only feature that needs file
  uploads/storage** (where blobs live on the Pi, size limits, thumbnail generation, serving static
  media) — a new infrastructure concern not yet present anywhere else in the app — so deferring it
  keeps Phase 5 free of that. Removed from the active Phase 5 counts (like F05 was); not deleted.
  When revived, it'd most naturally land alongside the Phase 9 storage/deploy hardening.
- _~~Phase 5~~ — parked; revisit later (see Phase 9 infra)._

### F27 — Rotating Chore Assignment ⭐

> _Inspired by **Hearth**'s rotating chores: a recurring chore automatically rotates between family
> members each occurrence (e.g. dishes — Mon→Alex, Tue→Sam, Wed→Jordan, then back to Alex)._

- **Approach:** A recurring `Task` can use a **rotating** assignment strategy over an ordered roster of
  members instead of a fixed assignee. The assignee for each occurrence is resolved **deterministically
  from a rotation "bucket"** (`roster[bucket % len(roster)]`), so every device computes the same person
  and it stays stable across reschedules — no stored per-day assignee needed. Default stays **fixed**
  assignment (current F01 behavior).
- **Decoupled cadence (2026-06-21):** rotation cadence is **independent of recurrence** — a chore can
  recur on one schedule but hand off the owner on another (e.g. _dishes daily, but one person owns the
  whole week_). Cadence is `rotation_unit` (`occurrence` | `day` | `week` | `month`) × `rotation_interval`
  (N), anchored at `rotation_anchor_date` (defaults to `start_date`). Time units are **calendar-aligned**
  (weeks flip Monday, months on the 1st); `occurrence`/1 reproduces the original per-occurrence rotation,
  so existing rotating chores are unchanged.
- **BE:** `assignment_strategy` (`fixed` | `rotating`) + an **ordered** rotation roster on `Task` (an
  order column on `TaskAssignment`, or a `rotation_order` list); occurrence→assignee resolver that skips
  soft-deleted members; the resolved assignee is returned with each `…/tasks/occurrences` row.
- **FE:** A "Rotate between members" toggle + drag-orderable member list in the task editor; the device
  chore board shows **today's** rotated assignee per task (with an optional "up next" hint).
- **AC:** A rotating dishes chore shows a different, correctly-cycling member each day; removing a member
  advances the cycle without crashing; non-rotating chores are unchanged.
- **Status (2026-06-15):** ☑ Full-stack done. **BE:** `AssignmentStrategy` (`fixed`|`rotating`) on `Task`
  + `sort_order` on `TaskAssignment` for roster order (migration `006`); `get_task_occurrences` resolves
  the per-occurrence assignee from the **absolute occurrence index** (`roster[i % n]`), returns it as the
  single `members` entry plus an `up_next` member, and drops soft-deleted members from the live roster.
  `member_ids` order is the roster order. 4 tests in `tests/test_tasks.py` (suite 66 green). **FE:**
  "Rotate between members" Switch (≥2 members) + ordered roster with ↑/↓ in `task-sheet.tsx`, a "Rotating"
  badge on the task list, and a "Next: <name>" hint on the device chore board. `tsc` + `next build` clean.
  **Deferred:** drag-to-reorder the roster (↑/↓ ships now); live two-device smoke.
- **Update (2026-06-21) — decoupled cadence + forward-compat hooks:** added `rotation_unit` /
  `rotation_interval` / `rotation_anchor_date` to `Task` (migration `013`; defaults `occurrence`/`1`/null
  reproduce prior behavior). `get_task_occurrences` now resolves the assignee via a calendar-aligned
  **bucket** (`_rotation_bucket`) instead of the raw occurrence index, and `up_next` is the next
  **handoff** owner. Two robustness hooks landed alongside: the resolver consults an (empty)
  `_rotation_overrides(task)` map so a future per-occurrence **swap/skip** table (`TaskRotationOverride`)
  drops in with no rewrite, and `compute_streak` now counts a member's **assigned turns** only — a week
  owned by someone else no longer breaks a rotating chore's streak. **FE:** a "Rotate every N
  occurrence/day/week/month" control in `task-sheet.tsx`; the list badge shows the cadence
  (`describeRotation`). 6 new tests (suite **128** green); `tsc` + lint clean (lint's 1 pre-existing error
  is unrelated). The `TaskRotationOverride` swap/skip table that the hook anticipated is now built — see
  the next update.
- **Update (2026-06-21) — swap / skip / "not my week" overrides:** `TaskRotationOverride`
  (`task_id`, `occurrence_date`, nullable `member_id`; migration `014`) lets a rotating turn be manually
  **reassigned** (member set) or **skipped** (member NULL = excused, no one assigned), reverting by
  deleting the row. The resolver's override hook now reads the table; `get_task_occurrences` returns
  `is_overridden` / `is_skipped` (and `rotation_unit`/`rotation_interval`) per occurrence, resolves swap
  targets against **any** active family member, and `compute_streak` uses the **effective** assignee (a
  swapped-away turn isn't yours; a skip is no one's). Endpoints (owner/adult): `GET …/tasks/{id}/overrides`,
  `PUT …/overrides/{date}` (body `{member_id, scope}`), `DELETE …/overrides/{date}?scope=`. `scope="turn"`
  fans the action across every occurrence in the same rotation bucket, so "skip my whole week" is one call.
  Emits `task.override_set` / `task.override_cleared`. **FE:** a per-chore swap/skip/reset dropdown on the
  device board (owner/adult only), a "Skipped today" section with Restore, and a "Swapped in" marker. 7 new
  tests (suite **135** green); `tsc` + lint clean.
- **Known limitation (now mitigated):** the computed assignee is `roster[bucket % len]`, so
  **adding/removing/reordering** roster members still re-phases the cycle (and `compute_streak`/board
  recompute past assignees). The override table now lets you **manually correct** any specific turn that
  lands on the wrong person; full automatic stability (materializing resolved assignments) remains
  deferred — only worth it if fairness disputes ever matter.
- _Depends on **F01** (Tasks). Phase 5._

### F30 — Chore Load Balancer ⭐

> _Families set **how often** each chore happens but find it hard to decide **which day** it lands on and
> **who starts** so the load is spread out and no one gets buried. This auto-plans those two levers._

- **Approach:** Chore frequency (`rrule` `FREQ`/`INTERVAL`) is left untouched; the balancer only sets the
  two free levers per chore — the **day** (`rrule` `BYDAY` for weekly, day-of-month for monthly) and the
  **rotation phase / who-starts** (member order). A short in-app wizard asks who's sharing, which days are
  available, and per chore an effort weight (light/medium/heavy) + a mode (**Split** = rotate · **Fix** =
  always one person · **Leave** = keep as-is but count its load). It then searches day + who-starts to
  minimize an imbalance cost, and shows a **before→after** preview before applying.
- **Optimizer (pure, no DB):** `app/services/chore_balancer.py` simulates the next 4 weeks on **actual
  dates and weeks** (not horizon-averages — averaging would hide that a weekly-rotating chore alternates
  each week) and scores: per-person fairness, per-week balance (the staggering lever), per-day clump
  (spreads chores across days), per-person-per-day (anti-burying), and a peak tie-breaker. Greedy seed +
  hill-climbing with random restarts; deterministic per `seed` so "Regenerate" gives a different layout
  and Apply reproduces exactly what the preview showed.
- **BE:** reuses the real recurrence/rotation engine so the preview matches the device. Balancer-managed
  chores are normalized to `occurrence`/1 rotation re-anchored at the horizon, with member order chosen so
  the engine assigns the picked starter to the first occurrence. No new tables/columns — only existing
  `Task` fields are written. Endpoints (owner/adult): `POST …/tasks/balance-plan` (compute + preview),
  `POST …/tasks/balance-plan/apply` (one-transaction bulk apply, emits `task.updated`).
- **FE:** a 3-step "Balance chores ✨" wizard sheet (`components/tasks/balance-sheet.tsx`) off the Tasks &
  routines page — people/days → per-chore effort+mode → preview (per-person weekly load before→after, a
  typical-week heatmap, the busiest-day metric, and the per-chore change list) with Regenerate / Apply.
- **AC:** a lopsided "everything falls to one person" setup rebalances toward even; two weekly chores land
  on different days each starting with a different person; applying reproduces the previewed per-person
  load exactly; frequency is never changed; pinned ("keep its day") and fixed chores are respected.
- **Status (2026-06-29):** ☑ Full-stack done. **BE:** `chore_balancer.py` optimizer +
  `compute_balance_plan`/`apply_balance_plan` in `app/services/tasks.py`, schemas + 2 endpoints; 7 tests
  in `tests/test_balance.py` (suite **172** green), incl. an apply-matches-preview round-trip; `api.md`
  regenerated (90 routes). **FE:** balance wizard + `useBalancePlan`/`useApplyBalancePlan` hooks; `tsc` +
  lint clean. Builds on **F27**'s rotation engine.
- **Update (2026-06-29) — time-based effort via a rolling wheel:** replaced the coarse
  light/medium/heavy weight with a real **time estimate**, picked from **time buckets** (0–5, 5–10,
  10–15, 15–20, 20–30, 30–45, 45–60, 1–1.5 hr, 1.5–2 hr, 2+ hr) on a touch-friendly **rolling wheel**
  (`components/tasks/time-wheel.tsx`, dependency-free scroll-snap). New `Task.estimated_minutes` column
  (nullable; migration `018`; stores the bucket's representative minutes), set in the task editor and
  shown on the task row, and used directly as the balancer's load weight — so the preview reads in
  **min/wk**. The wizard **ports in** each chore's saved estimate (a tap-to-expand wheel per chore) and
  **requires** one for every chore before the plan can be generated/applied (amber “estimate?” + a gated
  button); **Apply persists** the chosen estimates back onto the tasks so they stick.
  `BalanceItemIn.effort` → `minutes` (1–1440). Suite **172** green.
- **Update (2026-06-29) — balanced chores start today-onward (BE):** each managed (rotate/fixed) chore's
  `start_date` is now **re-anchored to its soonest occurrence on/after today** (`_placements` sets
  `start_date = occ[0]`, the first horizon occurrence ≥ today, for the weekday / day-of-month / keep
  candidates alike). Because a task's series is anchored at `start_date`, this makes the chore's
  **pre-today occurrences stop generating** — so applying a plan cleanly wipes the old/backlog
  (overdue/"Missed") schedule and everything begins from the current day. Rotation phase alignment still
  holds (with `start_date = occ[0]`, `k0 = 0` so the chosen starter lands on the first occurrence). No
  schema/API change; +1 test (`test_apply_reanchors_start_to_today_and_clears_past`); suite **173** green.

### F28 — Recipe → Grocery List (ingredient aggregation) ⭐

> _Inspired by **Skylight**'s "advanced grocery integration" (auto-calculates ingredient quantities for
> meal plans) and **Cozyla**'s recipe-to-grocery list: build a grocery list from selected recipes or a
> week's meal plan, **summing duplicate ingredients**._ _(The original F05 Instacart hand-off is
> descoped, so the aggregated list is the end of the flow.)_

- **Approach:** Recipes carry **structured ingredients** (quantity, unit, name). A "build grocery list"
  action takes selected recipes **or** a meal-plan date range, **aggregates like ingredients** (2 + 3
  eggs → 5 eggs; merges compatible units, lists incompatible ones separately), and writes them as
  `ListItem`s on a grocery `List`. (Cozyla skips quantities; we do the Skylight-style quantity math, with
  a review step so users can adjust.)
- **BE:** `RecipeIngredient` (qty `float|null`, unit `str|null`, name) on `Recipe`; an aggregation
  service (unit-normalization + name canonicalization); `POST /families/{id}/grocery/from-mealplan?from&to`
  and `…/grocery/from-recipes` → creates/updates a grocery `List`.
- **FE:** "Add to grocery list" on a recipe and on the weekly meal-planner; a **review step** showing the
  aggregated, editable quantities before committing → writes into the existing F04 grocery list.
- **AC:** Two recipes sharing an ingredient produce one combined line with the summed quantity; a week's
  meal plan generates a complete grocery list; quantities are editable before save.
- **Status (2026-06-15):** ☑ Full-stack done (shipped with F15). **BE** (`services/meals.py`):
  `aggregate_ingredients` lightly canonicalizes names (lowercase, drop a single trailing plural-`s`,
  not `ss`) and maps units through a synonym table (tsp/tbsp/cup/oz/lb/g/kg/ml/l/clove/can/pinch…);
  quantities **sum only within an identical (name, canonical-unit) group**, so the same ingredient in
  incompatible units stays on separate lines (no cross-unit conversion). `POST …/grocery/aggregate`
  previews the merged lines from explicit `recipe_ids` **and/or** a meal-plan `from_date`+`to_date`
  range (meal-plan repeats count); `POST …/grocery/build` writes reviewed lines into a new or existing
  grocery `List` (reuses `services/lists.py`). **FE:** `components/meals/grocery-build-dialog.tsx` is the
  **editable review step** (per-line qty/name edits + removals, "from recipes" provenance, target a new
  or existing grocery list) reached via "Build grocery list" on the weekly board and "Add to groceries"
  on a recipe card. Covered by `tests/test_meals.py` (sum + unit-separation, meal-plan repeats, build
  into new/existing list). **The F05 Instacart push is gone — the aggregated F04 list is the end of the
  flow** (F29 Walmart export remains the optional Phase 9 hand-off).
- _Depends on **F04** (lists) + **F15** (recipes/meal plan). Phase 5._

### F29 — Grocery → Walmart hand-off (personal web automation) 🔌

> **Replaces the descoped F05 Instacart hand-off.** Personal-use only; deliberately one of the **last**
> features built (Phase 9).

- **Approach:** A **desktop worker** drives the Walmart UI with **SeleniumBase** (UC/CDP mode for
  anti-bot), reusing the owner's logged-in session (persistent Chrome profile, **home IP, real
  account**), to add a MySkylight grocery `List`'s items to a Walmart **list** (or cart). Best-effort:
  the owner then reviews and checks out (pickup/delivery slot + payment) **in Walmart**. It is **not** a
  hands-off ordering robot — Walmart exposes **no public consumer ordering API**, and the official
  add-to-cart/OPD APIs are partner-gated and a poor fit for a private household app (see git history /
  the F05 descope for that analysis).
- **Spike (already scaffolded):** `GithubProjects/WalmartGrocerySync/` — `login.py` (one-time
  interactive login → persisted `chrome-profile/`, never handles credentials) + `add_to_walmart.py`
  (search → add top result; gentle pacing; per-item report). **Parked** until Phase 9; the UC-mode
  session/reconnect/pacing pattern is solid, the CSS selectors need live verification.
- **BE (MySkylight):** read-only feed of a grocery `List`'s items for the worker (reuse
  `GET /families/{id}/lists/{id}`); optional per-item **preferred Walmart product URL/ID** so repeat
  items add deterministically instead of via fuzzy search.
- **FE:** an "export to Walmart" action on a grocery list + a last-run result view (added / not-found /
  needs-pick).
- **AC:** a MySkylight grocery list populates a Walmart list the owner can review and check out;
  unmatched items are reported for manual selection.
- **Caveats:** automated access is generally against Walmart's ToS (low practical risk for personal use
  on one's own account — worst case a flagged/captcha'd session); selectors are brittle; sessions
  expire; **runs on the desktop, not the Pi** (headless Chromium + anti-bot is too heavy for the Pi).
- _Phase 9 (last). Depends on **F04** (grocery lists)._

### F17 — Magic Import 🤖⭐

> _"Forward emails and PDFs, or upload photos of lists/flyers to automatically add dates and details."_

- **Approach (provider switched to Gemini 3.1 Flash-Lite, 2026-06-25 — see PLAN §2 D3):** Ingest via
  image/PDF upload (and, later, an inbound-email address) → **`gemini-3.1-flash-lite`** (a vision LLM)
  does **OCR + structured extraction in one call** → **draft events / list items** the user reviews &
  confirms. **No OCR pre-stage** (Tesseract/`pypdf` dropped — Gemini reads images and PDFs natively).
  The **same provider also drafts recipes** from a **photo or a link** (URL-context tool), feeding the
  F15 recipe library / F28 grocery aggregation.
- **BE:** `MagicImportJob` (state machine ingested→extracted→confirmed); ingest endpoints
  (`/magic-import` upload; inbound-email webhook deferred); `ai/provider.py` `GeminiProvider` →
  `response_schema` (Pydantic) JSON drafts; confirm → create real events/list-items/recipes.
- **FE:** Upload/snap UI; "review extracted events" screen with edit-before-save (drafts never
  auto-commit).
- **AC:** A flyer photo yields a correctly-dated draft event the user can tweak and save; a recipe photo
  **or URL** yields an editable recipe draft.
- **Status (2026-06-25):** ☑ **Backend + FE built; live verification pending.** **BE:**
  `app/ai/provider.py` (`GeminiProvider` + `get_provider()` DI seam, 15s timeout under the proxy),
  `app/ai/normalize.py` (date/tz: year-inference, all-day fallback, 1 h default), `app/schemas/magic_import.py`
  (drafts mirror `EventCreate`/`RecipeCreate`), `app/routers/magic_import.py`
  (`POST /families/{id}/magic-import/{events, recipes/image, recipes/link}`; 503 unconfigured,
  415/413/400 input guards; recipe-link uses a two-call url-context→`response_schema` fallback).
  **Stateless** — no `MagicImportJob`, no migration; confirm **reuses the existing `POST /events` /
  `POST /recipes`**. 14 tests in `tests/test_magic_import.py` (suite **155 green**); `docs/api.md`
  regenerated. **FE:** `hooks/use-magic-import.ts`, `lib/file-to-base64.ts` (canvas downscale → base64),
  `components/calendar/flyer-import-dialog.tsx` (toolbar **Import** on `/app`; multi-event review with
  per-row save + `year/time guessed` badges) and `components/meals/recipe-import-dialog.tsx`
  (Photo | Link → reuse `RecipeSheet` prefilled). `tsc` + `next build` + eslint clean. **Remaining:**
  live smoke with a real `GEMINI_API_KEY` (SDK surface verified against `google-genai 2.10`:
  model id, nested `response_schema`, `Tool(url_context=…)`).
- **Enriched fields (2026-06-25 follow-on):** widened what the import captures and saves so a wide
  range of flyers/recipes round-trip in full. **Events** now keep the AI-extracted `description` +
  `location` (model already had the columns; the flyer review UI now shows + saves them — no
  migration). **Recipes** gained `prep_minutes`, `cook_minutes`, `source_url` (recipes) and a per-
  ingredient `section` grouping header (`recipe_ingredients`) — **migration `017`** (bare nullable
  columns), plumbed through `RawRecipe`/`RecipeDraft` + the extraction prompt, the `RecipeSheet` form
  (time inputs, source URL, grouped-ingredient editing with live section subheadings), and the recipe
  card (total-time display). Suite **155 green**; `schema.sql` regenerated.
- _Phase 6_

---

## External calendar sync 🔌 (Phase 7)

> _"Seamlessly Auto-Syncs With: Google, Outlook, Apple, Cozi, Yahoo."_ Built last and incrementally;
> two-way where the provider allows, read-only otherwise.
>
> **Scope (decided 2026-06-15):** the household uses **Google** + **Apple/iCloud**, so Phase 7 keeps
> **F25** (done), **F18** (Google), and **F20** (Apple). **F19 (Outlook), F21 (Cozi), and F22 (Yahoo) are
> descoped** (not used) — specs kept below for later, struck through like F05. **Sync is read-only
> (one-way pull):** external events are mirrored in to *display* in the app; **MySkylight never writes back**
> to Google/Apple. This drops the two-way push, conflict-resolution, and write-back work entirely.

### F18 — Google sync 🔌 ⭐ _(kept — read-only)_

- **Approach:** OAuth2 + Google Calendar API (read-only `calendar.readonly` scope); incremental pull via
  sync tokens. **One-way: pull Google events in to display; no write-back.**
- **BE:** OAuth flow, `ExternalAccount` token store, mapping ext-calendar→`Calendar`+color, **pull only**.
- **Status (2026-06-16):** ☑ **Code-complete (connect + pull→mirror + FE), mock-tested; only live verification pending.**
  - **Connect (BE):** `app/models/external.py` — `ExternalAccount` (provider, tokens, expiry, status,
    soft-delete) + `ExternalCalendar` (discovered calendars, optional `calendar_id` map, `sync_token`);
    migration `010`. `app/services/google_oauth.py` — authorize-URL builder, code exchange, token
    refresh, userinfo, calendar-list (read-only), and an **HMAC-signed `state`** so the JWT-less callback
    is tied to the family that started it. `app/routers/external.py` — `POST …/external/google/authorize`
    (owner/adult; **503** when unconfigured), `GET /external/google/callback`, `GET …/external/accounts`,
    `DELETE …/{id}`. Creds from env (`google_client_id`/`_secret`/`_redirect_uri`); never committed.
  - **Pull → read-only mirror (BE, new 2026-06-16):** `google_oauth.fetch_events` — paginated `events.list`
    with `singleEvents=false` (recurring **masters** mirror with their RRULE) + `showDeleted` (incremental
    pulls see cancellations); per-calendar `syncToken` persisted, **410**→full resync, **401**→refresh
    (`ensure_fresh_token`, else `needs_reauth`). `app/services/external_sync.py` — the **shared mirror
    engine**: `apply_mirror_events` upserts events linked to the source `ExternalCalendar`
    (`Event.external_calendar_id`) keyed on a provider-namespaced `ical_uid` (`google:<extcal>:<eventid>`),
    soft-deleting on upstream removal. `PUT …/external/calendars/{id}` toggles `synced` (on/off);
    `POST …/external/accounts/{id}/sync` pulls on demand;
    an APScheduler `external_sync` job polls every `external_sync_minutes` (30). A pull publishes an SSE
    `event.created` nudge so devices refresh. `tests/test_external.py` — **38 tests** (parsing, mirror
    create/update/cancel, token refresh, mapping, manual-sync); suite **129 green**.
  - **FE (new 2026-06-16):** a "Calendar sync" page (`app/app/family/[id]/integrations/page.tsx`,
    owner/adult, linked from `FamilyMenu`) — **Connect Google** (`useGoogleAuthorize` → redirect to the
    consent URL; toasts when the server is unconfigured) and **Connect iCloud** (see F20). Each discovered
    calendar has an on/off **sync toggle** (`useSetCalendarSync` → `synced`) and an **editable color
    swatch** (`CalendarColorPicker` → `useSetCalendarColor` → PUT `{color}`, optimistic). The picker is a
    fixed **preset palette** (`CALENDAR_COLORS`, 16 tints — no free-form hex); colors already used by
    another *synced* calendar are flagged with a dot (and a toast on pick) so duplicates are a knowing
    choice, not blocked. Mirror events carry no color of their own, so recoloring the `ExternalCalendar`
    re-tints every occurrence live (fallback in `services/calendar.py::get_occurrences`) — no re-sync.
    Each row also shows "Synced <when>"; per-account there's a **Sync now** button + status badge, and a
    **⋯ menu** with **Clean up duplicates** + **Disconnect** (confirmed via AlertDialog). The OAuth
    callback returns to this page (`?external=connected|error`). Hooks in
    `hooks/use-external-calendars.ts`, types in `lib/types/external.ts`.
  - **Read-only enforcement (new 2026-06-16):** occurrences/events now carry a `read_only` flag, derived
    from the `google:`/`apple:` `ical_uid` prefix (`is_external_mirror` in `app/models/external.py`). The
    event sheet renders mirror events as a no-edit **details** view, and the events API **403s** any
    PATCH/DELETE on a mirror — so a local change can never be silently clobbered on the next pull. FE
    typecheck + lint clean.
  - **TODO:** **live end-to-end** only — needs a real Google Cloud OAuth client + account.
  - **Update (2026-06-28) — reconcile-on-full-pull (fixes long-lived mirror "duplicates"):** the mirror
    engine previously only ever *added/updated* rows and *removed* one only on an explicit upstream
    tombstone — it had **no reconcile-by-absence**, so any row whose key stopped matching the source (events
    deleted while a sync token was stale, or rows orphaned by an earlier keying/linkage such as the Model-B
    refactor) lingered forever and re-sync couldn't clear them. `apply_mirror_events` now takes
    `reconcile`/`window_start`: on a **full** pull (complete snapshot) it soft-deletes any prefixed mirror
    row the snapshot didn't contain, so the mirror converges to exactly what the source has. It runs **only**
    on a full pull (an incremental delta would wipe everything); a `window_start` guard protects one-offs
    ending before the pull's time bound (recurring masters are always in a full pull, so always reconcilable).
    `EventsPage.time_min` reports the Google window. Shared by Apple/CalDAV (whole-collection snapshot, no
    window). The full reconcile runs **off the request path** — the scheduler's periodic run, a provider
    sync-token expiry (410 → full pull), or toggling a calendar off→on (resets the cursor) — never through
    the synchronous "Sync now" button. **(Corrected same-day:** an earlier cut forced a full pull on "Sync
    now"; a full CalDAV pull re-fetches the whole collection and overran the frontend proxy's 20s timeout →
    a generic "Sync failed" toast. Manual "Sync now" is back to a fast **incremental** pull; reconcile stays
    on the off-request-path full pulls above. The sync endpoint now also maps errors precisely — 409
    reconnect / 502 with the provider message / 500 with the error type — and the FE shows that detail
    instead of a vague catch-all.) For an **on-demand** clean-up there's a separate **"Clean up duplicates"**
    action (`POST …/external/accounts/{id}/resync`, owner/adult) that runs the full reconcile as a FastAPI
    **background task** (its own session, like the scheduler) and returns **202** immediately — so the heavy
    CalDAV pull never hits the proxy timeout — then the realtime nudge refreshes the device when it finishes.
    +5 tests in `tests/test_external.py` (reconcile drop, incremental keeps, window guard, resync 202+queues,
    resync 404); suite **162 green**.
- **Update (2026-06-29) — catch-all duplicate cleanup (the reconcile couldn't reach these):** reconcile only
    prunes rows still linked (`external_calendar_id` + matching uid prefix) to a synced calendar. An earlier
    migration left some mirror rows **unlinked / stale-linked**: they carry a provider uid (so the UI treats
    them read-only — the user can't delete them) yet still render via the `external_calendar_id IS NULL`
    branch, and reconcile can't see them — so "Clean up duplicates" (the resync) left them. New
    `external_sync.cleanup_duplicate_mirror_events` + `POST …/external/cleanup-duplicates` (owner/adult): a
    **pure-DB** pass that groups the family's *visible* mirror events by identity (title+start+end+all-day)
    and, per group >1, keeps one copy (prefers the still-synced-linked one, else most-recently-updated) and
    soft-deletes the rest. Skips toggled-off calendars' hidden events; mirrors are re-pullable so it's safe;
    synchronous so it **returns the count removed** (the "Clean up duplicates" button now calls this and toasts
    "Removed N"). +3 tests (collapse unlinked dupes, leave toggled-off alone, endpoint count); suite **165 green**. _Note: this clears stale rows within one calendar; if "duplicates" are
    instead two `ExternalCalendar` rows for the same real calendar (a reconnect that re-keyed the calendar
    id), "Sync now" reports "0 removed" and the extra calendar is toggled off instead — see TRACKER follow-up._
- **Setup:** needs a Google Cloud OAuth client (ID/secret); for personal/self-hosted use, OAuth
  "testing" mode with the household's own accounts as test users avoids Google's app-verification review.
- **AC:** ✅ (code-complete) A Google event appears in MySkylight, **read-only and not editable in-app**
  (FE details view + API 403 on writes). _Proven by mock-tests; live display pending a real OAuth client._

### F19 — ~~Outlook sync~~ 🔌 — **DESCOPED** (household doesn't use Outlook)

- ~~**Approach:** Microsoft Graph OAuth2; two-way; delta queries.~~
- ~~**AC:** Outlook ↔ MySkylight events stay consistent.~~ — _Not built. Reusable if revived: shares
  the OAuth/`ExternalAccount`/sync-engine scaffolding with F18 (Google)._

### F20 — Apple sync 🔌 _(kept — read-only)_

- **Approach:** **CalDAV** (iCloud app-specific password); **read-only** (pull iCloud events in to display;
  no write-back).
- **Setup:** needs an iCloud account + app-specific password (appleid.apple.com → Sign-In and Security →
  App-Specific Passwords).
- **Status (2026-06-16):** ☑ **Code-complete (connect + pull→mirror + FE), mock-tested; only live verification pending.**
  - **Done (BE):** `app/services/caldav.py` — a small read-only CalDAV client (httpx + `xml.etree`, no new
    dependency). `POST …/external/apple/connect` (owner/adult) validates an Apple ID + app-specific password
    by **discovering** calendars (PROPFIND principal → calendar-home-set → list, filtered to VEVENT-capable
    collections), then stores them as `ExternalCalendar` rows on an `apple` `ExternalAccount` (the
    app-specific password is the durable credential, kept in `refresh_token`; **no new migration** — `apple`
    was already in migration `010`'s provider enum). Pull uses a `sync-collection` REPORT (RFC 6578:
    empty token = full, stored token = delta + removals, rejected token → full re-pull) and **reuses the ICS
    parser** (`app.services.ics`) on the returned `calendar-data`, feeding the **same** `apply_mirror_events`
    as Google (uid `apple:<calurl>:<href>`). `tests/test_external.py` covers CalDAV discovery/sync-report/401
    parsing, connect/reconnect/bad-creds, and the Apple mirror + auth→`needs_reauth`. Suite **129 green**.
  - **FE (new 2026-06-16):** **Connect iCloud** on the "Calendar sync" page opens
    `components/integrations/apple-connect-dialog.tsx` — an Apple ID + app-specific-password form
    (`useConnectApple`; links to appleid.apple.com; toasts 401 bad-creds / 502 unreachable). Discovered
    iCloud calendars map / sync / show status through the **same** `ExternalAccountCard` as Google. Mirror
    events get the shared `read_only` treatment (no-edit details view + API 403); see F18.
  - **TODO:** **live verification** only — needs a real iCloud app-specific password.
- **AC:** ✅ (code-complete) iCloud calendar events import **read-only** (shown but not editable in-app).
  _Proven by mock-tests; live display pending a real iCloud app password._

### F21 — ~~Cozi sync~~ 🔌 — **DESCOPED** (household doesn't use Cozi)

- ~~**Approach:** No public API → best-effort `.ics` feed import (read-only).~~ — _The mechanism still
  exists: F25's `import-ics` accepts a **feed URL**, so a Cozi `.ics` feed could be imported ad-hoc
  without reviving this as a named feature._

### F22 — ~~Yahoo sync~~ 🔌 — **DESCOPED** (not used)

- ~~**Approach:** CalDAV (app password); read-first.~~ — _Not built. Would reuse F20's CalDAV engine if revived._

### F25 — ~~ICS import/export~~ — **REMOVED** (2026-06-20)

- ~~**Approach:** Standard `.ics` import/export underpins any provider; useful on its own.~~
- **Status (2026-06-20):** Removed with the Model B refactor (no local `Calendar` to import into/export
  from). The `.ics` **parser** (`parse_ics` in `app/services/ics.py`) is **kept** — Apple/CalDAV sync (F20)
  still uses it — but the user-facing feature is gone: deleted `app/routers/sync.py`,
  `components/calendar/calendar-sync-dialog.tsx`, the `useImportCalendarIcs` hook, and the toolbar entry
  point. `events.ical_uid` (migration `009`) stays as the mirror dedup key. Re-addable later (likely as a
  family-level export) if wanted.
- **Revived as a read-only *subscription* (2026-06-30):** the import path is back in a narrower form — not
  file/calendar import, but a **subscribed `.ics` feed** modelled as a connected account
  (`ExternalProvider.ics`, no migration — SQLite stores the enum as a bare `VARCHAR` with no CHECK).
  `POST …/external/ics/connect {url, name?, color?}` validates + records a feed URL (`webcal://` normalised
  to https) as a synced `ExternalCalendar` under a per-family ICS container account, then kicks an immediate
  background pull. The existing `external_sync`/`apply_mirror_events` engine re-fetches it on the **5-min
  scheduler**, so a public **US-Holidays** feed stays current with **no re-import** (future years appear, old
  years fall off). Each pull is a full snapshot → always reconciles (with an empty-fetch guard so a transient
  glitch can't wipe the mirror). Events carry an `ics:<url>:<uid>` uid → **read-only**, hidden when the feed
  is toggled off, tinted by the feed's colour. Use case: the iPhone **US Holidays** calendar, which is a
  *subscribed* calendar iCloud's CalDAV never exposes to F20. Backend + tests done (`app/services/ics_feed.py`;
  +11 tests, suite **184 green**). **FE done:** a "Subscribe to a feed" dialog (`ics-feed-dialog.tsx`,
  one-tap US-Holidays fill) on the integrations page; the feed renders in the existing account card.
  **Zero-touch on deploy:** migration `019` seeds the US-Holidays subscription for every family, so holidays
  appear after deploy with no app interaction (the 5-min scheduler does the first pull).
  **Update (2026-11-07) — delete a single feed:** every feed shares one "Subscribed feeds" account, so the
  only removal was *Disconnect* (all feeds) — a phone user could just toggle one feed's sync off. Each feed
  row now has a trash button (confirm) → **`DELETE /families/{id}/external/calendars/{id}`**, which
  soft-deletes that feed's mirrored events and removes the feed (and the empty container with the last one).
  Subscribed feeds only — Google/Apple calendars are re-discovered each sync, so they keep the sync switch.

---

## Cross-cutting UX

### F26 — App settings & preferences

- **Approach:** A single **Settings** dialog reachable from the cog button in the `/app` header. Houses
  cross-cutting client preferences today, and is the destination for future device/family settings
  (sleep window → F09, default view / orientation → F09 + F12, etc.) so users have one place to look.
- **BE:** none yet — current preferences are client-side only. Server-backed device/family settings
  (F09/F12) will surface through this same dialog when their phases land.
- **FE:**
  - `components/settings-dialog.tsx` exports `SettingsButton` (cog icon → `Dialog`).
  - **Theme:** Light / Dark / System radio group, wired to `next-themes`.
  - **Calendar hours:** Start + End `Select` dropdowns controlling the visible time window on the week
    and day grids. Stored in `localStorage` under `skylight:settings:visibleHours` (format `"start-end"`,
    24h, default `"7-23"`); shared across `/app` and `/device` via `hooks/use-visible-hours.ts`, which
    broadcasts changes through a custom event so any mounted `CalendarView` re-renders live. Events
    outside the window are hidden; events that overlap an edge are clipped.
  - Replaces the standalone `<ThemeToggle />` previously in the app header. The component file
    (`components/theme-toggle.tsx`) is no longer imported but kept in the tree.
- **AC:**
  - Cog opens a Settings dialog containing Theme + Calendar hours.
  - Changing the hour range immediately re-flows the week and day grids on the current surface and on
    any other open tab/window.
  - The chosen hour range survives a reload.
- _Phase 2 (initial), expanded over Phases 8–9 as device/family settings move in._

---

## Feature → phase index

| Phase | Features                                             |
| ----: | ---------------------------------------------------- |
|     0 | F00\*, F03 (shell), F24 (scaffold)                   |
|     1 | F00, F02, F13                                        |
|     2 | F23, F24, F06, F07, F08, F02, F26                    |
|     3 | F01                                                  |
|     4 | F04 _(F05 Instacart descoped)_                       |
|     5 | F14, F15, F27, F28, **F30** _(F16 parked → revisit later)_ |
|     6 | F17, F15 (AI recipes + URL/photo recipe import)      |
|     7 | **F25** ☑, **F18** (Google), **F20** (Apple) _(F19/F21/F22 descoped)_ |
|     8 | F09, F12                                             |
|     9 | notifications, offline, a11y, deploy (cross-cutting), **F29** |

_\* foundational scaffolding begins in Phase 0, completed in Phase 1._
