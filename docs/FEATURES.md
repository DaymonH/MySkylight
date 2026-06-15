# MySkylight — Feature Inventory & Specs

Every feature advertised on the Skylight Calendar site, mapped to our implementation. Each has a
stable **ID** (referenced by [TRACKER.md](./TRACKER.md)), our approach, the backend (BE) and
frontend (FE) pieces, and **acceptance criteria** (AC) that define "done".

**Legend:** ⭐ = Calendar Plus (paid) feature · 🔌 = external integration · 🤖 = AI/DeepSeek

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
- **BE:** `Calendar`, `Event`, `EventAssignment`, `Reminder`; RRULE recurrence with per-occurrence
  overrides (this/following/all); `/calendars`, `/events`, `/events/{id}/occurrences`.
- **FE:** Event create/edit sheet (title, time, all-day, location, repeat, members, reminder, color).
- **AC:** Create/edit/delete single + recurring events; "edit this occurrence only" works; reminders persist.

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

### F05 — Grocery Shopping (Instacart) 🔌

> _"Add all items from your Grocery List to an Instacart order in just 2 taps. (US only)"_

- **Approach:** "Send to Instacart" from a grocery list. Use Instacart's official API if approved;
  otherwise a deep-link/affiliate "create cart" fallback. US-gated in UI.
- **BE:** `/instacart` action that maps list items → Instacart payload; feature flag + region check.
- **FE:** "Send to Instacart" button on grocery lists; graceful disabled state outside US.
- **AC:** Tapping sends current grocery items to Instacart (API or deep-link); clear messaging if unavailable.
- _Phase 4_

### F06 — Customized Views

> _"Toggle between day, week, month, and schedule views."_

- **Approach:** Four touch-friendly calendar views sharing one data layer; per-device default view.
- **BE:** Occurrence expansion endpoint with date-range params.
- **FE:** Day / Week / Month / Schedule(list) components; view toggle; remembers per-device choice.
- **AC:** All four views render the same events correctly, including recurring + all-day.
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
- _Phase 5 (AI recipe gen lands with Phase 6)_

### F16 — Photo Screensaver ⭐

> _"Display favorite photos when idle… organize into albums to choose what's featured."_

- **Approach:** Upload photos into albums; when the device is idle, run a slideshow from selected
  albums. Albums mark which are "featured".
- **BE:** `Album`, `Photo`, file storage + thumbnails; `/albums`, `/photos` (upload).
- **FE:** Album manager + uploader in `/app`; idle-detection slideshow on `/device`.
- **AC:** Upload to an album, mark featured; device idle → smooth slideshow of those photos.
- _Phase 5_

### F27 — Rotating Chore Assignment ⭐

> _Inspired by **Hearth**'s rotating chores: a recurring chore automatically rotates between family
> members each occurrence (e.g. dishes — Mon→Alex, Tue→Sam, Wed→Jordan, then back to Alex)._

- **Approach:** A recurring `Task` can use a **rotating** assignment strategy over an ordered roster of
  members instead of a fixed assignee. The assignee for each occurrence is resolved **deterministically
  from the occurrence's index** in the series (`roster[index % len(roster)]`), so every device computes
  the same person and it stays stable across reschedules — no stored per-day assignee needed. Default
  stays **fixed** assignment (current F01 behavior).
- **BE:** `assignment_strategy` (`fixed` | `rotating`) + an **ordered** rotation roster on `Task` (an
  order column on `TaskAssignment`, or a `rotation_order` list); occurrence→assignee resolver that skips
  soft-deleted members; the resolved assignee is returned with each `…/tasks/occurrences` row.
- **FE:** A "Rotate between members" toggle + drag-orderable member list in the task editor; the device
  chore board shows **today's** rotated assignee per task (with an optional "up next" hint).
- **AC:** A rotating dishes chore shows a different, correctly-cycling member each day; removing a member
  advances the cycle without crashing; non-rotating chores are unchanged.
- _Depends on **F01** (Tasks). Phase 5._

### F28 — Recipe → Grocery List (ingredient aggregation) ⭐🔌

> _Inspired by **Skylight**'s "advanced grocery integration" (auto-calculates ingredient quantities for
> meal plans) and **Cozyla**'s recipe-to-grocery list: build a grocery list from selected recipes or a
> week's meal plan, **summing duplicate ingredients**. Pairs with F05 to push the result to Instacart._

- **Approach:** Recipes carry **structured ingredients** (quantity, unit, name). A "build grocery list"
  action takes selected recipes **or** a meal-plan date range, **aggregates like ingredients** (2 + 3
  eggs → 5 eggs; merges compatible units, lists incompatible ones separately), and writes them as
  `ListItem`s on a grocery `List` — which F05 can then send to Instacart. (Cozyla skips quantities; we
  do the Skylight-style quantity math, with a review step so users can adjust.)
- **BE:** `RecipeIngredient` (qty `float|null`, unit `str|null`, name) on `Recipe`; an aggregation
  service (unit-normalization + name canonicalization); `POST /families/{id}/grocery/from-mealplan?from&to`
  and `…/grocery/from-recipes` → creates/updates a grocery `List`.
- **FE:** "Add to grocery list" on a recipe and on the weekly meal-planner; a **review step** showing the
  aggregated, editable quantities before committing; then the existing F04 list + F05 "Send to Instacart".
- **AC:** Two recipes sharing an ingredient produce one combined line with the summed quantity; a week's
  meal plan generates a complete grocery list; quantities are editable before save.
- _Depends on **F04** (lists) + **F15** (recipes/meal plan); feeds **F05** (Instacart). Phase 5._

### F17 — Magic Import 🤖⭐

> _"Forward emails and PDFs, or upload photos of lists/flyers to automatically add dates and details."_

- **Approach:** Ingest via email-forwarding address / PDF / image upload → **OCR/text extraction** →
  **DeepSeek** structured extraction → **draft events/list items** the user reviews & confirms.
  (DeepSeek is text-first, so OCR feeds it text — see PLAN §2.) The **same ingest pipeline also drafts
  recipes** from a URL or photo (Hearth-style "Smart Companion") feeding the F15 recipe library / F28
  grocery aggregation.
- **BE:** `MagicImportJob`; ingest endpoints (`/magic-import` upload + inbound-email webhook);
  OCR stage (PDF text/Tesseract); `ai/provider.py` (DeepSeek) → strict JSON drafts; confirm → create.
- **FE:** Upload/forward UI; "review extracted events" screen with edit-before-save.
- **AC:** A flyer photo yields a correctly-dated draft event the user can tweak and save.
- _Phase 6_

---

## External calendar sync 🔌 (Phase 7)

> _"Seamlessly Auto-Syncs With: Google, Outlook, Apple, Cozi, Yahoo."_ Built last and incrementally;
> two-way where the provider allows, read-only otherwise.

### F18 — Google sync 🔌

- **Approach:** OAuth2 + Google Calendar API; incremental (sync tokens); two-way.
- **BE:** OAuth flow, `ExternalAccount` token store, mapping ext-calendar→`Calendar`+color, push/pull.
- **AC:** A Google event appears in MySkylight and a MySkylight event appears in Google.

### F19 — Outlook sync 🔌

- **Approach:** Microsoft Graph OAuth2; two-way; delta queries.
- **AC:** Outlook ↔ MySkylight events stay consistent.

### F20 — Apple sync 🔌

- **Approach:** **CalDAV** (iCloud app-specific password); read-first, then write.
- **AC:** iCloud calendar events import; writes land back when enabled.

### F21 — Cozi sync 🔌

- **Approach:** **No public API** → best-effort **`.ics` feed import** (read-only). Set expectations in UI.
- **AC:** A Cozi-published ICS feed imports events read-only.

### F22 — Yahoo sync 🔌

- **Approach:** **CalDAV** (app password); read-first.
- **AC:** Yahoo calendar events import.

### F25 — ICS import/export (enabler)

- **Approach:** Standard `.ics` import/export underpins Cozi + any provider; useful on its own.
- **AC:** Import a `.ics` file into a calendar; export a calendar as `.ics`.

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
|     4 | F04, F05                                             |
|     5 | F14, F15, F16, F27, F28                              |
|     6 | F17, F15 (AI recipes + URL/photo recipe import)      |
|     7 | F18, F19, F20, F21, F22, F25                         |
|     8 | F09, F12                                             |
|     9 | notifications, offline, a11y, deploy (cross-cutting) |

_\* foundational scaffolding begins in Phase 0, completed in Phase 1._
