# MySkylight — Implementation Tracker

The single source of truth for **what's done and what's next**. Check items off as you go.
Specs for each `Fxx` ID are in [FEATURES.md](./FEATURES.md); architecture in [PLAN.md](./PLAN.md).

**How to use:** work top-to-bottom by phase. Tick `- [x]` when an item is merged + minimally tested.
Update the **Progress summary** counts when you complete a phase. Tags: `[INFRA]` `[BE]` `[FE]` `[AI]` `[🔌]`.

**Status legend:** ☐ not started · ◐ in progress · ☑ done · ⏸ blocked/parked

> **Status note (reconciled with the code):** both surfaces are live — backend at
> `HomeServerAPI/skylight-api/` and frontend at `SkylightClone/MySkylight/`. Phase 0 is done; Phases 1–2
> are largely done with a few FE items + automated tests outstanding. **Backend** items below were verified
> against the code; **`[FE]` ticks are inferred from the presence of the corresponding files/components**
> (e.g. `components/calendar/{day,week,month,schedule}-view.tsx`, `event-sheet.tsx`, `countdown-strip.tsx`)
> and may need a behavioural pass to confirm. The previously-separate finer-grained FE checklist (the old
> `SkylightClone/{Plan,Tracker,Features}.md`) has been **folded into this file** — see
> [Appendix A](#appendix-a--frontend-granular-checklist-fe-only); those root files are now thin pointers here.

## Progress summary

| Phase | Theme                                  | Status |                        Done / Total                         |
| ----: | -------------------------------------- | :----: | :---------------------------------------------------------: |
|     0 | Foundations                            |   ☑    |                           19 / 19                           |
|     1 | Identity & family (Clerk)              |   ☑    |                           15 / 15                            |
|     2 | Calendar core ⭐                       |   ☑    |                           24 / 24                           |
|     3 | Tasks & routines                       |   ☑    |                           10 / 10                           |
|     4 | Lists (groceries; Instacart descoped)  |   ☑    |                           7 / 7                             |
|     5 | Calendar Plus I (rewards/chores/meals/grocery; F16 photos parked) |   ◐    |       19 / 21                |
|     6 | Smart / AI (Gemini Flash-Lite)         |   ◐    |                           9 / 14                            |
|     7 | External sync (Google + Apple, **read-only**; F19/F21/F22 descoped) |   ◐    |        12 / 15              |
|     8 | Device & system                        |   ☐    |                           0 / 10                            |
|     9 | Polish & hardening (+ F29 Walmart hand-off) |   ☐    |                      0 / 17                            |
|       | **Total**                              |        |                        **115 / 151**                        |

---

## Phase 0 — Foundations `☑`

Goal: both apps boot, talk to each other, and the data/auth/realtime plumbing exists.

**Repo & tooling**

- [x] `[INFRA]` Initialize git repo at root; add root `.gitignore` (Python, Node, `.env`, `*.db`) — both repos have `.gitignore` covering `.env`, `*.db`, `venv`
- [x] `[INFRA]` Add root `README.md` + `docs/` (done) and a `.env.example` for each app — FE + BE both have `.env.example`; backend README still TODO
- [x] `[INFRA]` Decide local dev: run scripts / `docker-compose.yml` (api + web) — API via `HomeServerAPI/docker-compose.yml`; web via Netlify (`netlify.toml`)

**Backend skeleton — `HomeServerAPI/skylight-api/`**

- [x] `[BE]` FastAPI app factory, settings (pydantic-settings), CORS, `/health`, `/version`
- [x] `[BE]` SQLAlchemy 2.0 async engine + session; SQLite WAL + `foreign_keys=ON`; base model + mixins (id, timestamps, soft-delete)
- [x] `[BE]` Alembic configured; first migration; `entrypoint.sh` runs `alembic upgrade head`
- [x] `[BE]` Project layout: `app/{core,models,schemas,routers,services,deps}`
- [x] `[BE]` Realtime bus skeleton + `GET /api/v1/.../stream` (SSE) auth-scoped to family
- [x] `[BE]` Clerk: env keys (`CLERK_SECRET_KEY`, JWKS URL, webhook secret) + JWT-verification dependency (JWKS) + `/webhooks/clerk` (Svix verify)
- [x] `[BE]` Pytest + httpx async client; passing smoke tests
- [x] `[BE]` Structured logging + request IDs

**Frontend shell — `SkylightClone/MySkylight/`**

- [x] `[FE]` Read Next.js 16 docs before routing/data work (see `MySkylight/AGENTS.md`)
- [x] `[FE]` Routes: `/device` (kiosk layout) and `/app` (mobile layout) shells render
- [x] `[FE]` Clerk: `@clerk/nextjs` `<ClerkProvider>` + sign-in/up routes; session token attached server-side via the `/api/backend` proxy
- [x] `[FE]` Typed API client (`lib/api-client.ts`, `hooks/use-api.ts`) + Query provider + env
- [x] `[FE]` Design tokens / theme (`theme-provider`), base shadcn components (`components/ui`), device vs mobile layouts
- [x] `[FE]` Realtime subscription hook (SSE) wired to cache (`hooks/use-realtime.ts`, F24 scaffold)
- [x] `[FE]` PWA: web manifest + service worker registration (`public/manifest.json`, `public/sw.js`, `components/pwa-register.tsx`)
- [ ] `[FE]` App shell loading/error states; offline fallback page _(verify)_

---

## Phase 1 — Identity & family `☑` (auth, families, members, invites, profile switcher, and security tests all done) → F00, F02, F13

Goal: real auth, families, members with colors, and sharing.

- [x] `[BE]` Models: `User` (keyed by `clerk_user_id`, no password), `Family`, `Membership`, `Member` (role, color, avatar)
- [x] `[BE]` Clerk JWT verification dependency (JWKS, networkless) → resolve `clerk_user_id` → `User`; `GET /me`
- [x] `[BE]` `/webhooks/clerk` (Svix-verified `user.created/updated/deleted`) → upsert/soft-delete `User`; JIT provisioning fallback
- [x] `[BE]` Per-family authorization dependency (role-aware) used by all routers
- [x] `[BE]` `/families` CRUD + `/members` CRUD (color, avatar) — **F02**
- [x] `[BE]` `Invitation` model + `/invitations` create/accept/revoke (roles) — **F13** _(accept auto-creates the user's `Member` persona via `ensure_member_for_user`, idempotent; the owner's persona is created on family-create the same way)_
  - [x] `[BE]` Link-invite-to-existing-profile (claim-on-accept) — **F13** _(nullable `Invitation.member_id`, migration `015`; accept claims the unclaimed persona instead of duplicating, so chore assignments carry over. See FEATURES F13 enhancement 2026-06-25.)_
- [x] `[FE]` Clerk `<SignIn>`/`<SignUp>` + route protection + `<UserButton>`; Clerk token attached via the proxy (`app/sign-in`, `app/sign-up`, `app/app/layout.tsx`)
- [x] `[FE]` Create-family wizard (post sign-in onboarding) (`app/app/onboarding/page.tsx`)
- [x] `[FE]` Member management UI: add member, color picker, avatar (`app/app/family/[familyId]/members/page.tsx`) — **F02** _(edit-member drawer still TODO — see Appendix A)_
- [x] `[FE]` Profile switcher (device + mobile) _(member avatar filter in `components/calendar/member-filter.tsx`, state in `hooks/use-active-member.ts`; wired into `CalendarView` so both `/device` and `/app` get it. Scopes the calendar to one member; "All" clears. Strict filter — unassigned family-wide events show under "All". **Distinct from** the deferred multi-**family** switcher for co-parents.)_
- [x] `[FE]` Invite flow: send invite (role picker), pending list, revoke, copy-link, accept-invite landing — **F13** _(link-based: `InvitationOut` exposes `token`; reached via new `FamilyMenu` header menu. Optional rename/recolour on accept deferred — BE auto-creates the persona)_
  - [x] `[FE]` Invite form "Link to existing profile" picker (unlinked members) + "Links to <name>" badge on pending invites — **F13**
- [x] `[BE]` Color-resolution helper (event→member→calendar) — **F02** _(`_resolve_color` in `services/calendar.py`)_
- [x] `[ ] ` Tests: Clerk JWT verification, webhook user-sync, cross-family authz rejection, invite accept _(JWT verify in `tests/test_security.py`; webhook user-sync in `tests/test_webhooks.py`; cross-family + role rejection in `tests/test_authz.py`; invite create/list/revoke/accept in `tests/test_invitations.py` — 31 backend tests green)_
- [x] `[ ] ` AC: two Clerk users share one family with correct roles _(proven end-to-end at the API in `tests/test_invitations.py::test_accept_invitation_adds_member_and_persona`)_
- [x] `[BE]` Realtime: emit member/family changes _(members + families routers publish `member._`/`family.updated`)\*

---

## Phase 2 — Calendar core ⭐ `☑` (recurring events, four views, color, weather, countdowns, hardened realtime) → F23, F24, F06, F07, F08, F02

Goal: the heart — recurring events, four views, color, weather, countdowns, live updates.

**Events engine — F23**

- [x] `[BE]` Models: `Calendar`, `Event`, `EventAssignment`, `Reminder` (+ `EventException` for overrides)
- [x] `[BE]` RRULE recurrence (`python-dateutil`) + per-occurrence overrides/exceptions
- [x] `[BE]` `/calendars`, `/events` CRUD; `/families/{id}/events/occurrences?from&to`
- [x] `[BE]` Edit modes: this-occurrence / this-and-following / all
- [x] `[BE]` Member assignment on events (multi) → color coding — **F02**
- [x] `[BE]` Reminders persisted (delivery in Phase 9)
- [x] `[FE]` Event create/edit sheet (`components/calendar/event-sheet.tsx`)
- [x] `[FE]` Color rendering across views (`components/calendar/event-dot.tsx`) — **F02**

**Views — F06**

- [x] `[FE]` Day view (timeline, touch) (`components/calendar/day-view.tsx`)
- [x] `[FE]` Week view (`components/calendar/week-view.tsx`)
- [x] `[FE]` Month view (`components/calendar/month-view.tsx`)
- [x] `[FE]` Schedule (agenda list) view (`components/calendar/schedule-view.tsx`)
- [x] `[FE]` View toggle (`components/calendar/calendar-view.tsx` + `components/ui/tabs.tsx`) — _remembers per surface: `/device` → `skylight:view:device` (defaults week), `/app` → `skylight:view:app` (defaults month); persisted to `localStorage` in `changeView`_
- [x] `[FE]` Configurable visible-hours window on day/week grid (`hooks/use-visible-hours.ts`, `components/settings-dialog.tsx`) — **F26**

**Realtime — F24**

- [x] `[BE]` Emit `event.*` / `calendar.*` on mutations to family channel
- [x] `[FE]` Subscribe + reconcile cache (`hooks/use-realtime.ts`); device updates ≤ ~1s _(hardened: reconnects on `visibilitychange`/`online` since iOS Safari drops SSE when backgrounded, and resyncs every family-scoped cache on each reconnect to catch up on missed events)_
- [x] `[ ] ` AC: phone-created recurring event appears on device instantly, correct color _(mechanism complete + code-verified: backend emits `event.*` → FE invalidates `["occurrences", familyId]`; colors resolve via `_resolve_color`. A live two-device smoke is the final sign-off.)_

**Weather — F07**

- [x] `[BE]` Weather client (Open-Meteo default) + `WeatherCache` (on-demand, 1 h TTL); `/families/{id}/weather`
- [x] `[BE]` Scheduled weather refresh (APScheduler) — `services/scheduler.py` re-fetches cached forecasts every `WEATHER_REFRESH_MINUTES` (default 30) so the device stays fresh without a request
- [x] `[FE]` Weather strip (`components/calendar/weather-icon.tsx`, `hooks/use-weather.ts`)

**Countdowns — F08**

- [x] `[BE]` `is_countdown` flag + `days_until` returned with occurrences
- [x] `[FE]` Countdown tiles (`components/calendar/countdown-strip.tsx`)

---

## Phase 3 — Tasks & routines `☑` (full stack — chore board, `/app` management, routines, streaks) → F01

Goal: interactive chores/routines kids can check off; streaks.

> **FE status (2026-06-14):** built and verified on macOS via `npm run typecheck` + `next build`
> (both new routes compile) against the already-tested backend; a live two-device click-through is the
> remaining sign-off.

- [x] `[BE]` Models: `Task`, `Routine`, `TaskCompletion` (per-occurrence) _(`app/models/task.py` + `TaskAssignment` m2m; migration `003_tasks_routines.py`)_
- [x] `[BE]` Recurring chores via RRULE engine; assignment to members _(date-based recurrence anchored at `start_date` in `services/tasks.py::_task_occurrence_dates`; one-off = no rrule)_
- [x] `[BE]` `/tasks`, `/routines`, `/tasks/{id}/complete` (+ undo); streak calc _(`routers/tasks.py`; `POST/DELETE …/complete` idempotent; `GET …/streak?member_id` via `compute_streak` — "today pending doesn't break the run")_
- [x] `[FE]` Per-member checklist cards on `/device` (big tap targets, completion animation) _(`components/tasks/chore-board.tsx` at route `/device/chores`; one card per member, today's chores grouped by routine, optimistic toggle with check-pop + strikethrough. New `components/device-nav.tsx` adds a Calendar/Chores top nav to the kiosk via `app/device/layout.tsx`.)_
- [x] `[FE]` Task/routine management in `/app` _(`app/app/family/[familyId]/tasks/page.tsx` + `components/tasks/task-sheet.tsx`: create/edit/delete tasks with routine, start date, recurrence preset, member assignment; owner/adult-gated. Linked from `FamilyMenu`.)_
- [x] `[FE]` **Custom recurrence days** — "Custom days…" in the Repeat select reveals Mon–Sun chips that build a `FREQ=WEEKLY;BYDAY=…` rrule (e.g. Tue + Sat) _(2026-06-21: `lib/recurrence.ts` adds `WEEKDAYS`/`parseByday`/`bydayRrule`/`weekdayOf` + `describeTaskRrule` reads custom sets back as "Tue, Sat"; backend `rrulestr` already supported arbitrary BYDAY. Decoupled rotation cadence (F27) unaffected. `tsc` + lint clean)_
- [x] `[FE]` **Week view + Missed/overdue + filters (both surfaces)** — Today/Week toggle, a "Missed" section for un-done chores from earlier days, and a status·person·routine·frequency filter bar _(2026-06-25: shared logic in `lib/chores.ts` (TZ-safe Sunday-aligned dates, filter/overdue predicates) + `classifyFrequency` in `lib/recurrence.ts`; shared `components/tasks/chore-filter-bar.tsx`. Device `chore-board.tsx` gains the toggle, a per-day done/total week strip, the Missed card, and the filter bar; **fixed a bug** where completion hard-coded today — now uses each occurrence's date so past/other-day chores check off correctly. New companion view `components/tasks/chores-panel.tsx` at `/app/family/[familyId]/chores` (grouped-by-day list, tap-a-face to complete) linked from `FamilyMenu` ("Chores" vs "Manage tasks"). No BE change — `…/tasks/occurrences?from&to` already served ranges. `next build` + `tsc` + eslint clean.)_
- [x] `[FE]` **Richer task editor: color · end date · every-N-interval · reorder · rotation anchor** _(2026-06-25: `task-sheet.tsx` + `tasks/page.tsx`. Color swatch picker (`MEMBER_COLORS` + "Auto") → `Task.color`; optional "Ends" date → rrule `UNTIL=YYYYMMDD` (date-form, naive-compatible; dateutil-verified inclusive); "Custom interval…" number+unit → `FREQ=…;INTERVAL=N` for days/weeks/months (replaces the days-only control); ↑/↓ task reorder writes sequential `sort_order` (drag still deferred); `rotation_anchor_date` exposed for week/month cadences. Editor splits stored rrule into pattern+UNTIL and recombines on save; helpers in `lib/recurrence.ts` (`intervalRrule`/`parseInterval`/`withUntil`/`stripUntil`). No BE change. `next build` + tsc + eslint clean.)_
- [x] `[BE+FE]` **"Move to today" — re-phase a missed chore's cadence** _(2026-07-14; `POST …/tasks/{id}/move-to-today` → `move_task_to_today` in `services/tasks.py` re-anchors `start_date` to today so the whole future series re-phases from today, preserves week/month rotation phase, and optionally completes today for the acting member; guards to recurring interval-style chores only (rejects one-offs, `BYDAY=`/`BYMONTHDAY=`, expired `UNTIL`). FE: a "Move to today" 3-dot-menu item on the device board (`chore-board.tsx`, incl. week grid — Missed = one tap that also completes) + companion panel (`chores-panel.tsx`, re-phase only), gated by `canRephase` (`lib/recurrence.ts`), hook `useMoveTaskToToday`. No migration; suite 198 + tsc/lint green; `api.md` → 92 routes. See FEATURES.md F01.)_
- [ ] `[~]` **Future (F01 backlog):** per-chore icon/emoji (needs `Task.icon` + migration + picker); chore reminders & overdue push nudges (Phase 9 notifications track — Web Push + per-occurrence scheduling, reuse Event `Reminder`); parent approval/photo-proof on completion (gates check-off, ties into rewards). See FEATURES.md F01.
- [x] `[FE]` Routine builder (group tasks into morning/bedtime, ordered) _(create/rename/delete routines inline; tasks grouped under their routine, "Anytime" for the rest; deleting a routine un-groups its tasks. Ordered by `sort_order`; drag-to-reorder deferred.)_
- [x] `[FE]` Streak/habit indicator _(`MemberStreakBadge` shows the per-member current streak on each recurring task via `GET …/streak`; `hooks/use-tasks.ts::useStreak`.)_
- [x] `[BE]` Realtime: emit `task.*` _(also `routine.*`; `task.completed`/`task.uncompleted` carry member_id + date)_
- [x] `[ ] ` Tests: completion, daily reset, streak, recurrence _(`tests/test_tasks.py` — 8 tests: daily/weekly expansion, per-date completion + idempotency, foreign-member reject, streak run + past-miss, routine/task CRUD via API, child-completes/viewer-refused)_
- [x] `[ ] ` AC: kid checks a morning routine on device; parent sees it on mobile _(UI built; `task.*`/`routine.*` SSE wired in `hooks/use-realtime.ts` so a device check invalidates the board on every screen. Build + typecheck green; a live two-device smoke is the final sign-off.)_

---

## Phase 4 — Lists & groceries `☑` (F04 done; **F05 Instacart descoped**) → F04

Goal: shared lists. _(Instacart hand-off dropped — see below.)_

> **Status (2026-06-15):** F04 built full-stack and verified — backend `tests/test_lists.py`
> (7 tests; suite **62 green**), FE `tsc --noEmit` + `next build` both clean (new routes
> `/app/family/[familyId]/lists` and `/device/lists` compile). **F05 (Grocery → Instacart) is
> descoped** — the owner doesn't use Instacart, so the integration + its research spike are dropped (not
> deferred). Phase 4 is therefore complete on its remaining (F04) scope. A live two-device smoke is the
> only outstanding nicety.

- [x] `[BE]` Models: `List`, `ListItem` (text, qty, category, checked, assignee) _(`app/models/list.py`; `ListType` enum todo/grocery; `quantity` is free-text — "2 lbs"/"a dozen" — F28 adds structured qty on recipes; migration `005_lists.py`)_
- [x] `[BE]` `/lists`, `/list-items` CRUD + reorder; list types (todo/grocery) _(`app/routers/lists.py` — items are **nested** under `/families/{id}/lists/{id}/items` to match the family-scoped events/tasks pattern, not a top-level `/list-items`. `POST …/lists/reorder` + `POST …/lists/{id}/items/reorder` set `sort_order` by index. Roles: owner/adult manage lists; **owner/adult/child** add/check/edit items, viewers read-only)_
- [x] `[BE]` Realtime: emit `list.*` _(`list.created/updated/deleted/reordered` + `list.item_added/item_updated/item_deleted/items_reordered`)_
- [x] `[FE]` List screens (device + mobile): quick-add, check/uncheck, categories, reorder _(mobile mgmt at `app/app/family/[familyId]/lists` — list chips + create, quick-add, check/uncheck, category grouping, completed section, per-item edit sheet `components/lists/list-item-sheet.tsx` for qty/category/assignee; device board `components/lists/list-board.tsx` at `/device/lists` with big tap targets + optimistic check. **Reorder: backend done, FE drag deferred** like task drag-reorder)_
- [x] `[FE]` Shared live edits across surfaces _(`list.*` wired into `hooks/use-realtime.ts` → invalidates `["lists", familyId]`; both surfaces mount `useRealtime`. Linked from `FamilyMenu` + the device `DeviceNav`)_
- [x] `[ ] ` Tests: list CRUD, concurrent check sync _(`tests/test_lists.py` — 7 tests: list+item CRUD via service & API, check/uncheck stamps `checked_at`, assignee-must-be-family-member, item reorder, list reorder via API, child-adds/viewer-refused. Concurrent check sync = idempotent BE toggle + optimistic FE cache patch)_
- [x] `[ ] ` AC: grocery edits sync live across device + mobile _(mechanism complete + code-verified: `list.*` SSE invalidates `["lists", familyId]`; optimistic check on both surfaces. A live two-device smoke is the final sign-off)_
- [~] `[BE]` `[🔌]` ~~Instacart: API integration **or** deep-link/affiliate fallback; region flag~~ — **F05 DESCOPED** (not using Instacart)
- [~] `[FE]` `[🔌]` ~~"Send to Instacart" on grocery lists~~ — **F05 DESCOPED**
- [~] `[ ] ` ~~AC: Instacart hand-off works or degrades gracefully~~ — **F05 DESCOPED**
- [~] `[ ] ` ~~Research: confirm Instacart API access / fallback approach (spike)~~ — **F05 DESCOPED**

---

## Phase 5 — Calendar Plus I `◐` (F14 ☑, F27 ☑, F15+F28 ☑, F30 ☑; **F16 photos ⏸ parked**) → F14, F15, F27, F28, F30

Goal: rewards economy, meal planning + recipes (photo screensaver F16 parked — needs file storage,
revisit later; see its FEATURES entry).

**Rewards — F14 `☑`**

- [x] `[BE]` Models: `Reward`, `StarBalance`, `Redemption`; award hook on `TaskCompletion` _(`app/models/reward.py`: `Reward` + `Redemption` (status pending/approved/rejected, `star_cost` snapshot); **`StarBalance` is computed, not stored** — earned = Σ `TaskCompletion.stars_awarded` (snapshot of `Task.star_value` at completion, set in `complete_task`), spent = approved redemptions, pending reserves; migration `007` adds `tasks.star_value` + `task_completions.stars_awarded`)_
- [x] `[BE]` `/rewards`, `/rewards/redeem` (+ parent approval) _(`routers/rewards.py`: rewards CRUD (owner/adult), `…/rewards/{id}/redeem` (owner/adult/child, validates available ≥ cost), `…/star-balances`, `…/redemptions?status=`, `…/redemptions/{id}/approve|reject` (owner/adult). Emits `reward.*`)_
- [x] `[FE]` Star balance per child, reward shop, redeem + approval, celebratory UI _(`app/app/family/[familyId]/rewards`: per-member balance chips, parent approval queue, reward shop with a redeem member-picker dialog + celebratory toast, catalog mgmt via `components/rewards/reward-sheet.tsx`. Device board `components/rewards/reward-board.tsx` at `/device/rewards`. Task editor gains a "Stars for completing" input; chore board + task list show a ⭐ value. `reward.*`/`task.*` wired into `use-realtime.ts` → balances refresh)_

**Rotating chores — F27 `☑`** _(extends F01; Phase 3 tasks engine is done)_

- [x] `[BE]` Task `assignment_strategy` (fixed/rotating) + ordered rotation roster; per-occurrence assignee = `roster[occurrence_index % n]` (skips removed members); returned with `…/tasks/occurrences` — **F27** _(`AssignmentStrategy` enum + `TaskAssignment.sort_order` for roster order — `member_ids` order = roster order; migration `006`. Resolver in `services/tasks.py::get_task_occurrences` expands from `start_date` for the absolute occurrence index; rotating occurrence carries the single resolved assignee in `members` + an `up_next` member; soft-deleted members drop out of the live roster)_
- [x] `[FE]` "Rotate between members" toggle + drag-orderable roster in the task editor; chore board shows today's rotated assignee (+ optional "up next") — **F27** _(`task-sheet.tsx`: Switch (gated to ≥2 members) + ordered roster with ↑/↓ reorder — **drag deferred**; chip selection preserves rotation order. `tasks/page.tsx` shows a "Rotating" badge; `chore-board.tsx` shows "Next: <name>" via `up_next`. Rotating occurrence resolves to one assignee so it lands on the right member card)_
- [x] `[ ] ` Tests: rotation cycles correctly across occurrences; member removal advances the cycle; fixed assignment unchanged — **F27** _(`tests/test_tasks.py` — 4 new: cycle across 7 days, window uses absolute index, soft-deleted member skipped without crash, fixed shows all members. Suite **66 green**)_
- [x] `[BE]` **Decoupled rotation cadence + forward-compat hooks** — **F27** _(2026-06-21: `rotation_unit`/`rotation_interval`/`rotation_anchor_date` on `Task`, migration `013`, defaults reproduce per-occurrence. `get_task_occurrences` resolves via calendar-aligned `_rotation_bucket` (weeks→Mon, months→1st); `up_next` = next handoff owner. Hooks: empty `_rotation_overrides(task)` so a future `TaskRotationOverride` swap/skip table is additive; `compute_streak` counts assigned turns only. 6 new tests, suite **128 green**)_
- [x] `[FE]` **"Rotate every N occurrence/day/week/month" cadence control** — **F27** _(`task-sheet.tsx` interval + unit select under the rotate toggle; list badge shows cadence via `describeRotation`; `lib/types/task.ts` carries the new fields. `tsc` + lint clean)_
- [x] `[BE]` **Rotation overrides: swap / skip / "not my week"** — **F27** _(2026-06-21: `TaskRotationOverride(task_id, occurrence_date, member_id nullable)`, migration `014`. Reassign (member set) or skip (NULL); revert = delete. Resolver applies via the override hook + returns `is_overridden`/`is_skipped`; swap targets = any active family member; `compute_streak` uses the effective assignee. Endpoints `GET`/`PUT`/`DELETE …/tasks/{id}/overrides[/{date}]` (owner/adult), `scope="turn"` fans across the bucket; emits `task.override_*`. 7 new tests, suite **135 green**)_
- [x] `[FE]` **Swap/skip/reset dropdown on the device chore board** — **F27** _(`chore-board.tsx`: per-rotating-chore menu (owner/adult), "Skipped today" section with Restore, "Swapped in" marker; `useSetRotationOverride`/`useClearRotationOverride` in `use-tasks.ts`. `tsc` + lint clean)_
- [ ] `[ ]` **Deferred:** true roster-change stability — add/remove/reorder roster still re-phases the cycle; overrides let you correct individual turns, but materializing resolved assignments (for fairness disputes) is unbuilt — **F27**

**Chore load balancer — F30 `☑`** _(extends F27; auto-picks day + who-starts to even the load)_

- [x] `[BE]` Pure optimizer `app/services/chore_balancer.py` — scores per-person fairness, per-week + per-day balance, day-spread (clump), anti-burying (person-day), peak; greedy + hill-climb w/ restarts, deterministic per `seed` — **F30** _(2026-06-29; scores on **actual dates/weeks** so weekly-rotating staggering is rewarded, not washed out by averaging)_
- [x] `[BE]` `compute_balance_plan` / `apply_balance_plan` in `services/tasks.py` reuse the real recurrence + rotation engine (preview matches the device); managed chores normalized to `occurrence`/1 re-anchored at the horizon, member order chosen so the picked starter takes the first occurrence; no new tables/columns — **F30** _(endpoints `POST …/tasks/balance-plan` + `…/balance-plan/apply` (owner/adult), bulk apply in one txn, emits `task.updated`; `api.md` → 90 routes)_
- [x] `[BE]` Tests: spread across days + stagger starters, even a lopsided load, fixed/keep/lock modes, **apply reproduces the previewed per-person load** — **F30** _(7 in `tests/test_balance.py`; suite **172 green**)_
- [x] `[FE]` 3-step "Balance chores ✨" wizard off the Tasks page (`components/tasks/balance-sheet.tsx`): people + days → per-chore time estimate + mode (Split/Fix/Leave) + keep-day → before→after preview (weekly load, typical-week heatmap, busiest-day, change list) w/ Regenerate + Apply — **F30** _(`useBalancePlan`/`useApplyBalancePlan` in `use-tasks.ts`; `lib/types/balance.ts`; `tsc` + lint clean)_
- [x] `[BE+FE]` **Time-based effort via a rolling wheel** — `Task.estimated_minutes` (nullable, migration `018`), picked from time buckets (0–5 … 2+ hr) on a dependency-free scroll-snap wheel (`components/tasks/time-wheel.tsx`) in the task editor + the wizard; shown on the row; used as the balancer's load weight (preview in min/wk); wizard ports in saved estimates + requires one per chore before the plan can be generated, Apply persists them back — **F30** _(2026-06-29; `BalanceItemIn.effort`→`minutes`; suite **172** green; schema.sql + api.md regenerated)_

**Meal planning & recipes — F15 / F28 `☑`**

- [x] `[BE]` Models: `MealPlan` (date, slot), `Recipe` (steps, image, tags) + structured `RecipeIngredient` (qty/unit/name) — **F15/F28** _(`app/models/meal.py`: `Recipe` + `RecipeIngredient` (qty `float|null`, unit, name) + `MealPlan` (`MealSlot` enum, recipe **or** free-text title, soft `calendar_event_id` link); migration `008`)_
- [x] `[BE]` `/mealplans`, `/recipes`; project meals onto calendar (optional) _(`routers/meals.py` — family-scoped recipe CRUD (update replaces the ingredient set), `mealplans?from&to`, and `…/mealplans/{id}/to-calendar` projecting a per-slot-timed event, re-projection updates the same event)_
- [x] `[FE]` Weekly meal planner board (breakfast/lunch/dinner/snack) _(`app/app/family/[familyId]/meals` "This week" tab — prev/next week, per-day slot rows, add-meal dialog, per-meal calendar/remove menu)_
- [x] `[FE]` Recipe library + detail + manual entry/upload _("Recipes" tab + `components/meals/recipe-sheet.tsx` with dynamic qty·unit·name ingredient rows, servings, tags)_
- [x] `[FE]` "Add meal to calendar" _(per-meal dropdown → `useMealToCalendar`; invalidates occurrences so it shows on the calendar live)_
- [x] `[BE]` Grocery aggregation: unit-normalize + merge like ingredients → `ListItem`s; `POST …/grocery/aggregate` (preview) + `…/grocery/build` (commit) — **F28** _(synonym-table unit canonicalization; sums within identical (name, unit), incompatible units stay separate; source = recipe_ids and/or a meal-plan range, repeats count)_
- [x] `[FE]` "Add to grocery list" from a recipe + the weekly meal planner; editable review step before commit (writes to the F04 grocery list; F05 "Send to Instacart" was descoped) — **F28** _(`components/meals/grocery-build-dialog.tsx` — editable lines + "from recipes" provenance + new/existing target list)_

**Photo screensaver — F16 `⏸` parked (needs file storage; revisit later)**

- [~] `[BE]` ~~Models: `Album`, `Photo`; storage interface + thumbnail generation~~ — **F16 PARKED**
- [~] `[BE]` ~~`/albums`, `/photos` (upload, featured flag)~~ — **F16 PARKED**
- [~] `[FE]` ~~Album manager + uploader in `/app`~~ — **F16 PARKED**
- [~] `[FE]` ~~Idle detection + slideshow on `/device` from featured albums~~ — **F16 PARKED** _(the only feature needing file uploads/storage — deferred so Phase 5 stays storage-free; kept in FEATURES for later)_

**Cross-cutting (Phase 5) `☑`** _(F16's photo/upload portions parked with F16)_

- [x] `[BE]` Realtime: emit `reward.*`, `mealplan.*` (+ `recipe.*`) _(**`reward.*` ✓**, **`mealplan.*`/`recipe.*` ✓**; `photo.*` parked with F16)_
- [x] `[ ] ` Tests: star award/redeem math, meal→calendar _(star award/redeem ✓ `tests/test_rewards.py`; meal→calendar ✓ `tests/test_meals.py::test_meal_to_calendar_creates_then_updates_one_event`; upload pipeline parked with F16. Suite **81 green**)_
- [x] `[ ] ` Tests: rotation cycle (F27); ingredient aggregation + unit-merge, meal-plan → list (F28) _(rotation cycle ✓ `tests/test_tasks.py`; aggregation sum/unit-separation + meal-plan repeats + build ✓ `tests/test_meals.py`)_
- [x] `[ ] ` AC: chore completion awards stars; redeem needs approval _(`tests/test_rewards.py::test_earn_redeem_approve_balance_math` + `::test_reward_roles_via_api`)_
- [x] `[ ] ` AC: a rotating chore shows a different, correctly-cycling member each day — **F27** _(proven in `tests/test_tasks.py::test_rotating_assignment_cycles_across_occurrences`; device board surfaces today's assignee + "up next")_
- [x] `[ ] ` AC: a week's meal plan / selected recipes build an aggregated grocery list (summed quantities) — **F28** _(`tests/test_meals.py::test_aggregate_from_mealplan_counts_repeats` + `::test_recipe_meal_aggregate_flow_via_api`; FE review step before commit)_
- [~] `[ ] ` AC: idle device shows album slideshow; meals appear on calendar — _meals-on-calendar ✓ (F15 to-calendar); **slideshow parked with F16**_

---

## Phase 6 — Smart / AI (Gemini Flash-Lite) `◐` (backend done; FE review UIs pending) → F17, F15(AI)

Goal: Magic Import (flyer→events) + recipe quick-add (photo/link→recipe) + smart recipe generation.
**Provider decided 2026-06-25: `gemini-3.1-flash-lite` (vision LLM), replacing DeepSeek — the vision
model does OCR + extraction in one call, so the OCR pre-stage is dropped. See PLAN §2 D3.**

**Foundation**

- [x] `[AI]` `app/ai/provider.py` — `GeminiProvider` (`google-genai` SDK): `response_schema` structured output, image+PDF parts, URL-context tool, prompt templates; `get_provider()` DI seam (503 + test-mock point). `GEMINI_API_KEY`/`GEMINI_MODEL` in config; `google-genai>=2.0` dep
- [x] `[BE]` Shared Pydantic draft schemas (`EventDraft[]`, `RecipeDraft`) in `app/schemas/magic_import.py` + pure date/tz normalizer `app/ai/normalize.py`. **`MagicImportJob` model + state machine deferred** — only needed for the async inbound-email path; v1 is **stateless** (extract → review → reuse create)
- [x] `[BE]` Ingest endpoints: `POST /families/{id}/magic-import/{events, recipes/image, recipes/link}` (base64 image/PDF + URL; 503 unconfigured, 415/413/400 input guards). Inbound-email webhook deferred

**Flow 1 — Flyer → calendar events (F17)**

- [x] `[AI]` Gemini image/PDF → `EventDraft[]` (title, start/end, all-day, location, is_countdown). Backend normalizes dates via `family.timezone`: year-inference, all-day fallback, 1h default _(member/color left for the user to set in review — not AI-assigned)_
- [x] `[BE]` Create real events from approved drafts — **satisfied by reuse of existing `POST /events`** (no new confirm endpoint; draft→create round-trip tested)
- [ ] `[FE]` Upload/snap UI + "review extracted events" edit-before-save screen (drafts never auto-commit)

**Flow 2 — Recipe photo OR link → recipes DB (F17/F15)**

- [x] `[AI]` Gemini recipe **photo** → `RecipeDraft` (steps, tags, structured ingredients qty/unit/name)
- [x] `[AI]` Gemini recipe-from-**link** via URL-context tool → `RecipeDraft` _(two-call fallback by default: url-context fetch → text → `response_schema`; one-call combo unverified server-side)_
- [x] `[BE]` Create `Recipe` + `RecipeIngredient[]` — **reuse of existing `POST /recipes`** (round-trip tested); feeds F15 library / F28 aggregation
- [ ] `[FE]` "Add from photo / paste a link" entry in the recipe library + review-before-save

**Smart recipe generation (F15)** _(optional follow-on — not in current scope)_

- [ ] `[AI]` Generate/parse a recipe from a text prompt via Gemini → `RecipeDraft`
- [ ] `[FE]` "Generate recipe" in the recipe library

**Tests & AC**

- [x] `[ ] ` Tests: 14 in `tests/test_magic_import.py` — 503 unconfigured, role-gate, happy event/recipe, empty extraction, mime/size guards skip provider, provider-error→502, URL two-call fallback, pure normalizer, draft→create round-trip. Backend suite **155 green**
- [~] `[ ] ` AC: backend proven (extraction + draft→create round-trip green); **FE review screens + live smoke pending** (Stages 6–7 / owner's real `GEMINI_API_KEY`)

---

## Phase 7 — External calendar sync 🔌 `◐` → F25 removed, F18 + F20 kept (**read-only**); **F19/F21/F22 descoped**

Goal: pull in the calendars this household uses — **Google** and **Apple/iCloud** — **read-only** (their
events display in the app; we never write back), on top of a standard **ICS** foundation. **Outlook (F19),
Cozi (F21), and Yahoo (F22) were descoped** on 2026-06-15 (not used here); specs kept in FEATURES for later.

> **Status (2026-06-15):** **F25 ICS import/export is built + tested** (backend). Export a calendar as
> `.ics`; import a `.ics` file **or a feed URL** (the generic URL-import survives the Cozi descope as a
> useful capability). **Write-back to Google/Apple is descoped** (2026-06-15) — sync is **one-way pull
> only**, which drops conflict-resolution and push. **Google (F18) + Apple (F20) need the owner's provider
> credentials** (a Google Cloud OAuth client; an iCloud app-specific password) before they can be built
> and tested end-to-end. **F25's FE import/export UI is now built** (a companion-app calendar toolbar
> action → dialog with calendar picker, `.ics` export download, and import via file upload / paste / feed URL).
> **F18's Google connect scaffold is built + tested** (OAuth authorize→callback→store/discover, list,
> disconnect; creds via env, 503 when unset). **Update (2026-06-16): the read-only pull engine is now
> built + tested for BOTH providers** — Google (incremental `syncToken` events.list → mirror) and **Apple/
> iCloud (F20, CalDAV** with an app-specific password: PROPFIND discovery + `sync-collection` REPORT, reusing
> the ICS parser). Shared mirror engine (`app/services/external_sync.py`) upserts external events into a
> mapped local calendar keyed on a provider-namespaced `ical_uid`; mapping + manual-sync endpoints and a
> 30-min scheduled poll are wired.
>
> **Update (2026-06-20): Model B refactor.** Removed the local `Calendar` entity (migration `012`). Native
> events are family-scoped + member-colored; synced events reference their source via
> `Event.external_calendar_id`. The per-calendar **map** became a simple **on/off `synced` toggle**
> (`PUT …/external/calendars/{id}` → `{synced}`; FE `useSetCalendarSync`). **F25 ICS import/export was
> removed** (the `parse_ics` parser is kept for CalDAV). Backend suite **122 green**.
>
> **Update (2026-06-16): the FE is now built and Phase 7 is code-complete.** A "Calendar sync"
> page (`app/app/family/[id]/integrations/`, owner/adult) connects Google (OAuth) + iCloud (Apple ID +
> app-specific password), maps each discovered calendar to a local one / a new one / off, runs **Sync now**,
> shows status + last-synced, and disconnects. **Read-only is now enforced end-to-end:** occurrences/events
> carry a `read_only` flag (derived from the `google:`/`apple:` `ical_uid` prefix), the event sheet shows
> mirror events as a no-edit details view, and the events API **403s** any PATCH/DELETE on a mirror. The
> OAuth callback now returns to the sync page. **Backend 129 green; FE typecheck + lint clean.** The only
> remainder is **live verification** with the owner's real Google Cloud OAuth client + iCloud app password.

- [x] `[BE]` `[🔌]` `ExternalAccount` + `ExternalCalendar` store (provider, tokens, status, discovered calendars) — **F18/F20** _(`app/models/external.py`; migration `010`; read-only one-way design — no write-back)_
- [x] `[BE]` `[🔌]` Enable/disable read-only mirroring of a discovered calendar _(`PUT …/external/calendars/{id}` → `{synced}` in `app/routers/external.py`; mirrored events link to the `ExternalCalendar` via `Event.external_calendar_id`; enabling resets the sync cursor for a full re-pull. **Updated 2026-06-20 (Model B):** replaced the old map-to-local-`Calendar` / auto-create mechanism)_
- [x] `[BE]` Sync engine: incremental **pull only** (read-only), scheduled polling _(no push / conflict resolution — write-back descoped)_ _(`app/services/external_sync.py` — provider-agnostic `MirrorEvent` + `apply_mirror_events` upsert keyed on a provider-namespaced `ical_uid`, soft-deletes on upstream removal; `POST …/external/accounts/{id}/sync` for on-demand; APScheduler `external_sync` job every `external_sync_minutes` (30) syncs all active accounts)_
- [x] `[BE]` **Reconcile-on-full-pull — converges the mirror to the source (clears stale "duplicates")** _(2026-06-28: `apply_mirror_events(reconcile=, window_start=)` — on a **full** pull (complete snapshot) it soft-deletes any prefixed mirror row the snapshot didn't contain; runs **only** on a full pull, never an incremental delta. Closes the gap where the engine only added/tombstoned and never removed-by-absence, so rows orphaned by an earlier keying (e.g. Model-B) lingered and re-sync couldn't clear them. `window_start` guards one-offs below the pull window; recurring masters are always reconcilable. `EventsPage.time_min` reports the Google window; Apple/CalDAV reconciles the whole collection. Reconcile runs **off the request path** — scheduler tick / provider 410 / toggle off→on (resets the cursor) — **not** the synchronous "Sync now" (a full CalDAV pull overran the FE proxy's 20s timeout → "Sync failed"; reverted same-day so "Sync now" stays a fast incremental pull). Sync endpoint now maps errors precisely (409 reconnect / 502 provider message / 500 type) and the FE surfaces the detail. On-demand full-reconcile resync runs as a background task (202, own session) so a heavy CalDAV pull never hits the proxy timeout. **"Clean up duplicates" button now calls a pure-DB catch-all** (`POST …/external/cleanup-duplicates` → `cleanup_duplicate_mirror_events`): reconcile only prunes rows linked to a synced calendar, but an old migration left some mirror rows unlinked/stale (read-only uid, so undeletable in the UI, yet still rendered) that reconcile can't reach; the cleanup groups visible mirror events by identity and collapses each to one live copy, synchronously returning the count removed (skips toggled-off calendars). +8 tests total, suite **165 green**. See FEATURES F18 2026-06-28/29)_
- [ ] `[~]` **Follow-up:** dedupe/merge **multiple `ExternalCalendar` rows mapping to the same real calendar** (a reconnect that returns a re-keyed calendar id) — reconcile is per-calendar so it can't merge these; today the extra calendar is just toggled off. Detect-and-merge on discovery is unbuilt
- [x] `[BE]` `[🔌]` ICS import/export foundation — **F25** _(`app/services/ics.py` + `app/routers/sync.py`: `GET …/calendars/{id}/ics` export, `POST …/calendars/{id}/import-ics` for inline `.ics` **or** a fetched feed URL; migration `009` adds `events.ical_uid`; re-import dedupes on it; RRULE + all-day round-trip. `tests/test_ics.py` — round-trip, recurrence expansion, re-import dedup, URL feed, both-source rejection, cross-family 404. Suite **88 green**)_
- [x] `[BE]` `[🔌]` Google OAuth **connect** flow, **read-only** — **F18** _(`app/services/google_oauth.py` + `app/routers/external.py`: `POST …/external/google/authorize` → consent URL (**503** when unconfigured), `GET /external/google/callback` exchanges the code → stores tokens + discovers calendars (an **HMAC-signed `state`** ties the no-JWT callback back to the family), `GET …/external/accounts` lists, `DELETE …/{id}` disconnects. `calendar.readonly` scope; creds via env (`google_client_id`/`_secret`/`_redirect_uri`). `tests/test_external.py` — 13 tests; suite **101 green**)_
- [x] `[BE]` `[🔌]` Google Calendar API **event pull → read-only mirror** — **F18** _(`google_oauth.fetch_events`: paginated `events.list` with `singleEvents=false` so recurring **masters** mirror with their RRULE, `showDeleted` so incremental pulls see cancellations; `syncToken` persisted per ext-calendar, **410** → full resync, **401** → token refresh via `ensure_fresh_token` (else `needs_reauth`). Tested with a mocked Google API — live still needs a real Google Cloud OAuth client)_
- [~] `[BE]` `[🔌]` ~~Outlook / Microsoft Graph OAuth2~~ — **F19 DESCOPED** (household doesn't use Outlook; would reuse F18's OAuth scaffolding if revived)
- [x] `[BE]` `[🔌]` Apple CalDAV (app password), **read-only** — **F20** _(`app/services/caldav.py`: `POST …/external/apple/connect` validates an Apple ID + **app-specific password** by discovering calendars (PROPFIND principal → calendar-home-set → list, VEVENT-only); pull uses a `sync-collection` REPORT (RFC 6578) and reuses `app.services.ics` to parse the returned `calendar-data`, feeding the same `apply_mirror_events`. Credential stored in `refresh_token`; provider already in migration `010`'s enum (no new migration). Tested with a mocked CalDAV transport — live needs a real iCloud app password)_
- [x] `[BE]` `[🔌]` **Subscribed `.ics` feed (read-only)** — **F25 (revived 2026-06-30)** _(`app/services/ics_feed.py` + `POST …/external/ics/connect`: validates/normalises a feed URL (`webcal://`→https), stores it as a synced `ExternalCalendar` under a per-family `ExternalProvider.ics` container account, kicks an immediate background pull. The 5-min `external_sync` scheduler re-fetches it via the same `apply_mirror_events` engine — every pull is a full snapshot so it **always reconciles** (future years appear, dropped years fall off; empty-fetch guard prevents wiping the mirror). Events keyed `ics:<url>:<uid>` → **read-only**, hidden when toggled off, tinted by the feed colour. **No migration** — `ics` fits the existing bare-`VARCHAR` provider column. +11 tests, suite **184 green**. Use case: the iPhone **US Holidays** calendar, which iCloud CalDAV won't expose to F20)_
- [x] `[FE]` `[🔌]` **Subscribe-to-feed UI** — F25 revival _(`components/integrations/ics-feed-dialog.tsx` (react-hook-form + zod, url/name/colour, one-tap "Use the US Holidays calendar" fill) + `useConnectIcsFeed` in `hooks/use-external-calendars.ts` → `POST …/external/ics/connect`; a "Subscribe to a feed" button on the integrations page. The feed then shows in the existing `ExternalAccountCard` (provider `ics` labelled "Subscribed feeds"), reusing the per-calendar toggle / Sync now / disconnect UI. typecheck + lint clean)_
- [~] `[BE]` `[🔌]` ~~Yahoo CalDAV (app password), read~~ — **F22 DESCOPED** (not used; would reuse F20's CalDAV engine if revived)
- [~] `[BE]` `[🔌]` ~~Cozi best-effort `.ics` import (no API), read-only~~ — **F21 DESCOPED** (not used; F25's URL-import covers the mechanism ad-hoc if ever needed)
- [x] `[FE]` `[🔌]` `.ics` import/export UI — **F25** _(`components/calendar/calendar-sync-dialog.tsx` + a toolbar action in `calendar-view.tsx`, companion/`app` surface only; export downloads a Blob via the auth proxy, import posts file/paste/URL through `useImportCalendarIcs`; typecheck + lint clean)_
- [x] `[FE]` `[🔌]` Connect-account UI (Google OAuth start, Apple CalDAV creds) for **F18/F20** _(`app/app/family/[id]/integrations/page.tsx` "Calendar sync" page, owner/adult only via `FamilyMenu`: **Connect Google** → `useGoogleAuthorize` → redirect to consent URL (toasts on 503-unconfigured); **Connect iCloud** → `apple-connect-dialog.tsx` Apple ID + app-specific-password form (`useConnectApple`, 401/502 handling, links to appleid.apple.com). OAuth callback now returns to this page (`?external=connected|error`) and toasts. Disconnect via AlertDialog. `hooks/use-external-calendars.ts`, `lib/types/external.ts`; added `put` to the API client)_
- [x] `[FE]` `[🔌]` Calendar mapping + color + sync status/last-synced; **read-only external events shown but not editable** _(`external-account-card.tsx`: per-discovered-calendar Select → map to existing local calendar / **＋ new calendar** / **don't sync** (`useMapExternalCalendar`), shows the external color swatch + "Synced <when>" per mapped calendar, **Sync now** (`useSyncExternalAccount`, count toast) + status badge (Connected / Reconnect needed). **Read-only enforcement:** occurrences/events now carry `read_only` (backend derives it from the `google:`/`apple:` `ical_uid` prefix); `event-sheet.tsx` renders a no-edit **details** view for them, and the events API **403s** PATCH/DELETE on a mirror. typecheck + lint clean)_
- [x] `[FE/BE]` `[🔌]` **Event source labeling — explains apparent "duplicates"** _(2026-06-28: `OccurrenceOut.source` (`EventSource`: kind local/external · label · provider · account_email), built in `get_occurrences` by batch-loading the `ExternalAccount`; no migration. The details sheet now shows "Synced from {calendar} · {Provider}" + account email for mirrors and "Added in MySkylight" for native events, so the same real-world event living in several connected sources (native + Google + iCloud) — which the per-calendar mirror dedup intentionally doesn't merge — is no longer indistinguishable. `tsc`/`next build`/eslint clean; +1 test, suite **157 green**. See FEATURES F23 2026-06-28. Follow-up (not done): cross-source dedup/merge or a per-calendar hide toggle)_
- [x] `[ ] ` Tests: token refresh, dedupe, recurrence mapping _(no conflict/push tests — write-back descoped)_ _(`tests/test_external.py` now 38 tests: event parsing units, mirror create/update/cancel, skip-unmapped, Google token refresh + `needs_reauth`, map/unmap, manual-sync 200/404/503, CalDAV discovery + sync-report + 401 parsing, Apple connect/reconnect/bad-creds, Apple mirror + auth→reauth. Suite **126 green**)_
- [~] `[ ] ` AC: a Google event appears in MySkylight (read-only, not editable) _(pull→mirror + **"not editable" now fully enforced** — FE shows mirror events as a read-only details view and the events API 403s writes; **mock-tested**. Only live verification with a real Google Cloud OAuth client remains)_
- [~] `[ ] ` AC: Apple/iCloud events import read-only _(CalDAV pull→mirror + read-only enforcement **done + mock-tested**; only live verification with a real iCloud app password remains)_
- [x] `[ ] ` Research spikes: CalDAV lib (Apple), Google sync-token delta _(resolved in-implementation: hand-rolled CalDAV via httpx + `xml.etree` reusing the ICS parser — no new dep; Google `syncToken` delta with 410→full-resync)_

---

## Phase 8 — Device & system `☐` → F12, F09

Goal: pairing/multi-screen, sleep schedule.

- [ ] `[BE]` `Device` model + settings (sleep window, orientation, default view)
- [ ] `[BE]` Pairing: issue/redeem short code, device-scoped token; `/devices/pair` — **F12**
- [ ] `[FE]` Pairing screen (generate/enter code) + device list/management in `/app` — **F12**
- [ ] `[ ] ` AC: two paired screens share data; unpair works; cross-household link
- [ ] `[BE]` Sleep schedule + scheduler emits sleep/wake; `/devices/{id}/settings` — **F09**
- [ ] `[FE]` Sleep overlay on `/device` (clock/blank) + wake-lock; settings UI — **F09**
- [ ] `[ ] ` AC: device sleeps/wakes on schedule, per device
- [ ] `[FE]` Orientation (landscape/portrait) + default-view settings
- [ ] `[BE]` Realtime: emit `device.*` (settings/sleep)
- [ ] `[ ] ` Tests: pairing, sleep scheduling, settings scope

---

## Phase 9 — Polish & hardening `☐`

Goal: notifications, offline, accessibility, performance, deploy.

- [ ] `[FE]` Web Push subscription + permission flow
- [ ] `[BE]` Push delivery for reminders + scheduler wiring (delivers Phase 2 reminders)
- [ ] `[FE]` Offline PWA: cache shell + last data; queue writes + replay on reconnect
- [ ] `[FE]` Android install: handle `beforeinstallprompt`, surface "Install app" button
- [ ] `[FE]` iOS install: show "Add to Home Screen" tooltip when `navigator.standalone === false` + iOS Safari
- [ ] `[FE]` SW update toast: listen for `controllerchange`, show "Updated — reload to apply" nudge
- [ ] `[FE]` Accessibility pass (contrast, focus, tap targets, screen-reader labels)
- [ ] `[FE]` Kiosk hardening: wake-lock, prevent stray navigation, fullscreen
- [ ] `[BE]` Rate limiting on abuse-sensitive routes + `/webhooks/clerk` (Clerk handles login rate-limiting)
- [ ] `[INFRA]` Nightly SQLite backup task + restore doc
- [ ] `[INFRA]` Docker Compose deploy (api + web) on a mounted volume
- [ ] `[INFRA]` CI: lint + typecheck + tests on push
- [ ] `[FE]` Performance: Lighthouse PWA pass, image/thumbnail optimization
- [ ] `[ ] ` End-to-end smoke across device + mobile
- [ ] `[ ] ` Docs: deploy guide, env reference, backup/restore

**Grocery → Walmart hand-off — F29** _(deliberately last; optional personal automation; replaces the descoped F05 Instacart)_

- [ ] `[BE]` `[🔌]` Grocery export feed for the worker: read a grocery `List`'s items; optional per-item "preferred Walmart product URL/ID" for deterministic adds — **F29**
- [ ] `[🔌]` Desktop **SeleniumBase** worker (UC/CDP anti-bot, persisted login session, owner's home IP) adds the list to a Walmart list/cart; owner reviews + checks out (Walmart has no public consumer ordering API) — **F29** _(spike already scaffolded at `GithubProjects/WalmartGrocerySync` — `login.py` + `add_to_walmart.py`; **parked** here until Phase 9; selectors need live verification; runs on the **desktop**, not the Pi)_

---

### Notes / parking lot

- Native mobile (Expo/React Native) deferred — PWA first; API stays client-agnostic (PLAN §9).
- ~~Instacart~~ (**descoped** — owner doesn't use it; F05 dropped from Phase 4) → grocery hand-off
  instead lands as **F29** (personal Walmart UI automation, Phase 9 — spike at
  `GithubProjects/WalmartGrocerySync`). **Phase 6 AI provider decided 2026-06-25: Gemini 3.1 Flash-Lite**
  (vision LLM) — the DeepSeek-vision research spike is resolved and the OCR pre-stage is dropped (see
  PLAN §2 D3). _(Cozi's spike is moot — F21 descoped.)_
- External sync (Phase 7) is **read-only**: Google + Apple/iCloud events are pulled in to display only;
  MySkylight never writes back. Outlook (F19), Cozi (F21), and Yahoo (F22) are descoped (decided 2026-06-15).

---

## Appendix A — Frontend granular checklist (FE-only)

Folded here from the former `SkylightClone/Tracker.md` (now a pointer). These are finer-grained FE build
items that **roll up into the phase checklists above** — they're kept for day-to-day FE work. Statuses
reconciled against the actual `SkylightClone/MySkylight/` tree.

**App shell** _(→ Phase 0)_

- [x] Root layout (`app/layout.tsx`) — ClerkProvider, ThemeProvider, fonts
- [x] Sign-in / sign-up pages (`app/sign-in`, `app/sign-up`)
- [x] App layout (`app/app/layout.tsx`) — header with logo + `UserButton`
- [x] Auth guard via `proxy.ts` / `middleware.ts` (`clerkMiddleware` + `auth.protect`)
- [x] Clerk webhook route (`app/api/webhooks/clerk/route.ts`)

**Onboarding** _(→ Phase 1)_

- [x] Onboarding page (`app/app/onboarding/page.tsx`) — create-family form
- [x] Invite-accept page (`app/invite/accept/page.tsx`) — token from URL → `POST /invitations/accept` _(thin landing: prompts sign-in/up for signed-out invitees via Clerk `redirect_url`, then auto-accepts; handles 404/410 + already-member. Optional rename/recolour still deferred — BE auto-creates the persona)_

**Family dashboard** _(→ Phase 1)_

- [x] App home (`app/app/page.tsx`) — fetches `/me` + `/me/memberships`; redirects to onboarding if no family
- [x] Edit family name (owner/adult) → `PATCH /families/{id}` _(inline rename in `components/family-name-editor.tsx`, shown as the members-page title; gated to owner/adult)_

**Members** _(→ Phase 1 / F02)_

- [x] Members page (`app/app/family/[familyId]/members/page.tsx`) — list, add, delete
- [x] Navigation to members from dashboard
- [x] Edit-member drawer (name, color, avatar URL) → `PATCH /members/{id}` _(`components/member-edit-sheet.tsx`, opened by a per-row pencil on the members page. **PIN reset deferred** with the family PIN-lock — no per-member PIN-verify flow consumes it yet)_

**Invitations** _(→ Phase 1 / F13)_

- [x] Invitations page — pending list (owner/adult). _Built at `app/app/family/[familyId]/invitations/page.tsx` (family-scoped, next to `members/`) rather than the originally-sketched `app/app/invitations/`, to match the existing route pattern and the family-scoped endpoints._
- [x] Send-invite form — email + role selector → `POST /families/{id}/invitations` _(+ copy invite link, since there's no email server)_
- [x] Revoke-invite action → `DELETE /families/{id}/invitations/{id}`

**Family PIN lock** _(BE done: `PATCH /families/{id}/lock`, `POST /families/{id}/lock/verify`)_

- [ ] Enable-lock / set-PIN flow (owner/adult)
- [ ] PIN-verify screen shown when the lock is active

**Realtime wiring** _(→ Phase 2 / F24; `hooks/use-realtime.ts` exists)_

- [x] Wire the SSE stream into the member list (member.created/updated/deleted) _(`use-realtime.ts` invalidates `["members", familyId]`; members page now mounts `useRealtime`, and the calendar's profile switcher refreshes too)_
- [x] Wire the SSE stream into the family header (family.updated) _(`use-realtime.ts` invalidates `["family", familyId]` + `["me","memberships"]`; surfaced on the members-page family-name header via `FamilyNameEditor`)_

**Infra / deploy**

- [x] Proxy route (`app/api/backend/[...path]/route.ts`) — injects Clerk JWT server-side
- [x] API helpers (`lib/api-client.ts`, `hooks/use-api.ts`, `lib/api.ts`, `lib/use-api-query.ts`)
- [x] `.env.local` configured; `skylight-api` Clerk JWT template created
- [ ] Netlify deploy configured (`netlify.toml` present — confirm pipeline)
- [ ] `app/api/webhooks/clerk` registered in the Clerk dashboard

**Settings & preferences** _(→ Phase 2 / F26; future home for F09 sleep + F12 orientation/default-view)_

- [x] `SettingsButton` cog in `/app` header opens Settings dialog (`components/settings-dialog.tsx`); replaces standalone `ThemeToggle`
- [x] Theme picker (Light / Dark / System) inside Settings, wired to `next-themes`
- [x] Calendar visible-hours preference (start + end dropdowns) shared via `hooks/use-visible-hours.ts` — `localStorage` key `skylight:settings:visibleHours`
- [ ] Add a `SettingsButton` (or equivalent surface) to `/device` so device-side settings are reachable without the companion app
- [ ] Delete unused `components/theme-toggle.tsx` once nothing else needs it

## Appendix B — Frontend conventions (FE-only)

Folded from the former `SkylightClone/Plan.md` (now a pointer). Architecture lives in [PLAN.md](./PLAN.md) §3.

**Actual route tree** (supersedes the old `(auth)/(app)` route-group sketch, which was never built):

```
app/
├── layout.tsx                         # ClerkProvider + theme + Query providers
├── page.tsx                           # landing / redirect
├── sign-in/[[...sign-in]]/page.tsx    # Clerk <SignIn />
├── sign-up/[[...sign-up]]/page.tsx    # Clerk <SignUp />
├── device/{layout,page}.tsx           # kiosk surface
├── app/
│   ├── layout.tsx                     # companion app shell (UserButton, nav)
│   ├── page.tsx                       # dashboard (redirects to onboarding if no family)
│   ├── onboarding/page.tsx            # create family
│   └── family/[familyId]/members/page.tsx
└── api/
    ├── backend/[...path]/route.ts     # proxy → backend (injects Clerk JWT)
    └── webhooks/clerk/route.ts        # forwards Svix-signed body to backend
```

_Not yet built (see Appendix A): `app/invite/accept`, `app/app/invitations`._

**API calls** — go through the proxy via the typed helpers; the proxy injects the Clerk JWT server-side, so
the client never handles tokens:

- reads → `useApi()` / `useApiQuery<T>(path)`
- mutations → `api.post/patch/delete` (TanStack Query mutations)

**Webhooks** — the Next.js route only forwards the raw body + Svix headers; **the backend verifies the
signature** (don't verify in Next). Register `…/api/webhooks/clerk` in the Clerk dashboard.

**Naming** — files kebab-case; components/types PascalCase; hooks/functions camelCase.
