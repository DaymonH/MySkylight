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
|     5 | Calendar Plus I (rewards/chores/meals/grocery/photos) |   ◐    |               4 / 26                |
|     6 | Smart / AI (DeepSeek)                  |   ☐    |                           0 / 11                            |
|     7 | External sync                          |   ☐    |                           0 / 16                            |
|     8 | Device & system                        |   ☐    |                           0 / 10                            |
|     9 | Polish & hardening (+ F29 Walmart hand-off) |   ☐    |                      0 / 17                            |
|       | **Total**                              |        |                        **79 / 154**                         |

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
- [x] `[FE]` Clerk `<SignIn>`/`<SignUp>` + route protection + `<UserButton>`; Clerk token attached via the proxy (`app/sign-in`, `app/sign-up`, `app/app/layout.tsx`)
- [x] `[FE]` Create-family wizard (post sign-in onboarding) (`app/app/onboarding/page.tsx`)
- [x] `[FE]` Member management UI: add member, color picker, avatar (`app/app/family/[familyId]/members/page.tsx`) — **F02** _(edit-member drawer still TODO — see Appendix A)_
- [x] `[FE]` Profile switcher (device + mobile) _(member avatar filter in `components/calendar/member-filter.tsx`, state in `hooks/use-active-member.ts`; wired into `CalendarView` so both `/device` and `/app` get it. Scopes the calendar to one member; "All" clears. Strict filter — unassigned family-wide events show under "All". **Distinct from** the deferred multi-**family** switcher for co-parents.)_
- [x] `[FE]` Invite flow: send invite (role picker), pending list, revoke, copy-link, accept-invite landing — **F13** _(link-based: `InvitationOut` exposes `token`; reached via new `FamilyMenu` header menu. Optional rename/recolour on accept deferred — BE auto-creates the persona)_
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

## Phase 5 — Calendar Plus I `☐` → F14, F15, F16

Goal: rewards economy, meal planning + recipes, photo screensaver.

**Rewards — F14**

- [ ] `[BE]` Models: `Reward`, `StarBalance`, `Redemption`; award hook on `TaskCompletion`
- [ ] `[BE]` `/rewards`, `/rewards/redeem` (+ parent approval)
- [ ] `[FE]` Star balance per child, reward shop, redeem + approval, celebratory UI

**Rotating chores — F27 `☑`** _(extends F01; Phase 3 tasks engine is done)_

- [x] `[BE]` Task `assignment_strategy` (fixed/rotating) + ordered rotation roster; per-occurrence assignee = `roster[occurrence_index % n]` (skips removed members); returned with `…/tasks/occurrences` — **F27** _(`AssignmentStrategy` enum + `TaskAssignment.sort_order` for roster order — `member_ids` order = roster order; migration `006`. Resolver in `services/tasks.py::get_task_occurrences` expands from `start_date` for the absolute occurrence index; rotating occurrence carries the single resolved assignee in `members` + an `up_next` member; soft-deleted members drop out of the live roster)_
- [x] `[FE]` "Rotate between members" toggle + drag-orderable roster in the task editor; chore board shows today's rotated assignee (+ optional "up next") — **F27** _(`task-sheet.tsx`: Switch (gated to ≥2 members) + ordered roster with ↑/↓ reorder — **drag deferred**; chip selection preserves rotation order. `tasks/page.tsx` shows a "Rotating" badge; `chore-board.tsx` shows "Next: <name>" via `up_next`. Rotating occurrence resolves to one assignee so it lands on the right member card)_
- [x] `[ ] ` Tests: rotation cycles correctly across occurrences; member removal advances the cycle; fixed assignment unchanged — **F27** _(`tests/test_tasks.py` — 4 new: cycle across 7 days, window uses absolute index, soft-deleted member skipped without crash, fixed shows all members. Suite **66 green**)_

**Meal planning & recipes — F15 / F28**

- [ ] `[BE]` Models: `MealPlan` (date, slot), `Recipe` (steps, image, tags) + structured `RecipeIngredient` (qty/unit/name) — **F15/F28**
- [ ] `[BE]` `/mealplans`, `/recipes`; project meals onto calendar (optional)
- [ ] `[FE]` Weekly meal planner board (breakfast/lunch/dinner/snack)
- [ ] `[FE]` Recipe library + detail + manual entry/upload
- [ ] `[FE]` "Add meal to calendar"
- [ ] `[BE]` Grocery aggregation: unit-normalize + merge like ingredients → `ListItem`s; `POST …/grocery/from-mealplan?from&to` + `…/grocery/from-recipes` — **F28**
- [ ] `[FE]` "Add to grocery list" from a recipe + the weekly meal planner; editable review step before commit (writes to the F04 grocery list; F05 "Send to Instacart" was descoped) — **F28**

**Photo screensaver — F16**

- [ ] `[BE]` Models: `Album`, `Photo`; storage interface + thumbnail generation
- [ ] `[BE]` `/albums`, `/photos` (upload, featured flag)
- [ ] `[FE]` Album manager + uploader in `/app`
- [ ] `[FE]` Idle detection + slideshow on `/device` from featured albums
- [ ] `[BE]` Realtime: emit `reward.*`, `mealplan.*`, `photo.*`
- [ ] `[ ] ` Tests: star award/redeem math, meal→calendar, upload pipeline
- [ ] `[ ] ` Tests: rotation cycle (F27); ingredient aggregation + unit-merge, meal-plan → list (F28)
- [ ] `[ ] ` AC: chore completion awards stars; redeem needs approval
- [ ] `[ ] ` AC: idle device shows album slideshow; meals appear on calendar
- [x] `[ ] ` AC: a rotating chore shows a different, correctly-cycling member each day — **F27** _(proven in `tests/test_tasks.py::test_rotating_assignment_cycles_across_occurrences`; device board surfaces today's assignee + "up next")_
- [ ] `[ ] ` AC: a week's meal plan / selected recipes build an aggregated grocery list (summed quantities) — **F28**

---

## Phase 6 — Smart / AI (DeepSeek) `☐` → F17, F15(AI)

Goal: Magic Import + smart recipe generation. **Revalidate DeepSeek vision support first (see PLAN §2).**

- [ ] `[AI]` `ai/provider.py` — DeepSeek client (OpenAI-compatible), JSON-mode, prompt templates, swappable
- [ ] `[BE]` `MagicImportJob` model + state machine (ingested→extracted→confirmed)
- [ ] `[BE]` Ingest: image/PDF upload endpoint + inbound-email webhook address
- [ ] `[BE]` OCR/extraction stage: PDF text (`pypdf`), images via OCR (Tesseract/PaddleOCR)
- [ ] `[AI]` DeepSeek structured extraction → draft events/list items (strict JSON schema)
- [ ] `[BE]` Confirm endpoint → create real events/items from drafts — **F17**
- [ ] `[AI]` Smart recipe generation/parse via DeepSeek — **F15**
- [ ] `[FE]` Upload/forward UI + "review extracted events" edit-before-save screen
- [ ] `[FE]` "Generate recipe" in recipe library
- [ ] `[ ] ` Tests: extraction JSON validation, confirm→create, failure/低-confidence handling
- [ ] `[ ] ` AC: a flyer photo yields a correctly-dated, editable draft event

---

## Phase 7 — External calendar sync 🔌 `☐` → F18–F22, F25

Goal: connect Google/Outlook/Apple/Yahoo/Cozi. Two-way where possible; read-only otherwise.

- [ ] `[BE]` `ExternalAccount` (provider, tokens, sync state) + map ext-calendar→`Calendar`+color
- [ ] `[BE]` Sync engine: incremental pull/push, conflict resolution, scheduled polling
- [ ] `[BE]` `[🔌]` ICS import/export foundation — **F25**
- [ ] `[BE]` `[🔌]` Google OAuth2 + Calendar API, two-way — **F18**
- [ ] `[BE]` `[🔌]` Outlook / Microsoft Graph OAuth2, two-way — **F19**
- [ ] `[BE]` `[🔌]` Apple CalDAV (app password), read→write — **F20**
- [ ] `[BE]` `[🔌]` Yahoo CalDAV (app password), read — **F22**
- [ ] `[BE]` `[🔌]` Cozi best-effort `.ics` import (no API), read-only — **F21**
- [ ] `[FE]` Connect-account UI per provider (OAuth start, CalDAV creds, ICS URL)
- [ ] `[FE]` Calendar mapping + color assignment + sync status/last-synced
- [ ] `[FE]` Per-provider capability messaging (two-way vs read-only)
- [ ] `[ ] ` Tests: token refresh, dedupe, conflict, recurrence mapping
- [ ] `[ ] ` AC: Google event ↔ MySkylight two-way
- [ ] `[ ] ` AC: Apple/Yahoo/Cozi import read-only
- [ ] `[ ] ` Research spikes: CalDAV libs, Graph delta, Cozi ICS availability

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
  `GithubProjects/WalmartGrocerySync`). DeepSeek vision and Cozi each still have a research spike before
  their phase — keep expectations realistic and ship graceful fallbacks.

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
