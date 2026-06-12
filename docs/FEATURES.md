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
  all stored in **our DB** (not Clerk Organizations). Child profiles can be PIN-gated.
- **BE:** `User` (keyed by `clerk_user_id`, no password), `Family`, `Membership`, `Member` models;
  Clerk JWT-verification dependency; `GET /me`; `/webhooks/clerk` (Svix-verified `user.*`) + JIT
  provisioning; `/families`, `/members`; per-family authz dependency.
- **FE:** Clerk `<ClerkProvider>` + `clerkMiddleware`; `<SignIn>/<SignUp>/<UserButton>`; create-family
  wizard (post sign-in); profile switcher; Clerk session token attached to the API client.
- **AC:** A Clerk user signs in, creates a family, and is `owner`; the backend rejects any request with a
  missing/invalid Clerk JWT and any cross-family access.

### F23 — Calendar & Events Engine
- **Approach:** The core CRUD + recurrence engine underneath all calendar features.
- **BE:** `Calendar`, `Event`, `EventAssignment`, `Reminder`; RRULE recurrence with per-occurrence
  overrides (this/following/all); `/calendars`, `/events`, `/events/{id}/occurrences`.
- **FE:** Event create/edit sheet (title, time, all-day, location, repeat, members, reminder, color).
- **AC:** Create/edit/delete single + recurring events; "edit this occurrence only" works; reminders persist.

### F24 — Realtime live-update
- **Approach:** Server pushes typed change events per family; clients reconcile cache.
- **BE:** SSE/WebSocket endpoint + in-process broadcast bus; emit on every mutating route.
- **FE:** Subscription hook that invalidates/patches TanStack Query cache.
- **AC:** An edit on the phone reflects on the device within ~1s without manual refresh.

---

## Standard / Free features

### F01 — Tasks Manager
> *"Encourage kids' independence and healthy habits with a fun, interactive checklist for daily routines and chores."*
- **Approach:** Tasks/chores assignable to members, optionally recurring, grouped into **Routines**
  (e.g. "morning", "bedtime"). Big, satisfying checkable UI on the device.
- **BE:** `Task`, `Routine`, `TaskCompletion` (per-occurrence); `/tasks`, `/routines`,
  `/tasks/{id}/complete`. Recurrence reuses the RRULE engine.
- **FE:** Per-member checklist cards on device + management in `/app`; completion animation.
- **AC:** Assign a recurring chore; child checks it off on device; resets next day; streak counts.
- *Phase 3*

### F02 — Color Coding
> *"Assign each family member their own color…"*
- **Approach:** Each `Member` has a color; events/tasks inherit it. Resolution: event override →
  member → calendar.
- **BE:** `color` on `Member`/`Calendar`/`Event`; resolved server-side helper.
- **FE:** Color picker in member setup; color-keyed legend + dots/bars across all views.
- **AC:** Each member shows a distinct color everywhere; multi-assignee events show all colors.
- *Phase 1–2*

### F03 — Mobile App
> *"Manage and access everything on your Skylight from anywhere…"*
- **Approach:** Responsive `/app` surface + installable **PWA** (D1). Same API as device.
- **BE:** n/a (shared API).
- **FE:** Mobile layouts, PWA manifest + service worker, install prompt, "add to home screen".
- **AC:** Installable on a phone; full create/edit from mobile; offline shell loads.
- *Phase 0 (shell) → all phases*

### F04 — Custom Lists
> *"Streamline and manage tasks, to-dos, and groceries with lists the whole family can access…"*
- **Approach:** Named lists (to-do / grocery types), shared family-wide, check/uncheck items.
- **BE:** `List`, `ListItem` (text, qty, category, checked, assignee); `/lists`, `/list-items`.
- **FE:** List screens on device + mobile; quick-add; swipe/tap to check; reorder.
- **AC:** Create a grocery list; both surfaces see live edits; checked items move/strike.
- *Phase 4*

### F05 — Grocery Shopping (Instacart) 🔌
> *"Add all items from your Grocery List to an Instacart order in just 2 taps. (US only)"*
- **Approach:** "Send to Instacart" from a grocery list. Use Instacart's official API if approved;
  otherwise a deep-link/affiliate "create cart" fallback. US-gated in UI.
- **BE:** `/instacart` action that maps list items → Instacart payload; feature flag + region check.
- **FE:** "Send to Instacart" button on grocery lists; graceful disabled state outside US.
- **AC:** Tapping sends current grocery items to Instacart (API or deep-link); clear messaging if unavailable.
- *Phase 4*

### F06 — Customized Views
> *"Toggle between day, week, month, and schedule views."*
- **Approach:** Four touch-friendly calendar views sharing one data layer; per-device default view.
- **BE:** Occurrence expansion endpoint with date-range params.
- **FE:** Day / Week / Month / Schedule(list) components; view toggle; remembers per-device choice.
- **AC:** All four views render the same events correctly, including recurring + all-day.
- *Phase 2*

### F07 — Weather
> *"Precise weather forecasting for the exact time and location of your events."*
- **Approach:** Fetch + cache forecasts by location; show conditions on day/event. Pluggable provider
  (Open-Meteo free default; swappable).
- **BE:** Weather client + `WeatherCache`; scheduled refresh; `/weather?location&date`.
- **FE:** Weather strip on day/week header; per-event weather when location + time known.
- **AC:** Today's hourly forecast shows on the device; an event with a location shows its forecast.
- *Phase 2*

### F08 — Event Countdowns
> *"Build excitement for birthdays, vacations, holidays, and more."*
- **Approach:** Mark an event as a countdown; device shows "N days until …" tiles.
- **BE:** `Countdown` (or flag on `Event`); `/events` returns countdown metadata.
- **FE:** Countdown widget on device home; "days until" on event detail.
- **AC:** Flagging an event surfaces an accurate live-updating countdown tile.
- *Phase 2*

### F09 — Sleep Mode
> *"Ensure your Skylight screen sleeps and wakes at the same time each day."*
- **Approach:** Per-device on/off schedule; device dims/blanks (or shows clock) during sleep window.
- **BE:** Sleep schedule on `Device` settings; scheduler emits sleep/wake; `/devices/{id}/settings`.
- **FE:** Sleep overlay on `/device`; settings UI; screen wake-lock handling.
- **AC:** Device blanks at the set time and wakes on schedule; configurable per device.
- *Phase 8*

### F10 — Parental Lock
> *"Prevent editing, adding, or deletion of your events and chores."*
- **Approach:** A family/device lock that gates mutating actions behind a parent PIN/role.
- **BE:** Lock state + PIN; authz checks reject mutations when locked unless elevated; `AuditLog`.
- **FE:** Lock toggle; PIN prompt before edit/add/delete on device; locked affordances hidden/disabled.
- **AC:** With lock on, a child cannot add/edit/delete; a correct PIN/parent role can.
- *Phase 1*

### F11 — Software Updates
> *"New features automatically download to your device."*
- **Approach:** PWA service-worker update channel: new build detected → cached → applied (with a
  subtle "updated" nudge). Backend exposes `/version`.
- **BE:** `/version` endpoint; optional release-notes feed.
- **FE:** SW update lifecycle (skipWaiting/clientsClaim), "update ready" toast, auto-apply on idle.
- **AC:** Deploying a new build updates the device without a manual reinstall.
- *Phase 8*

### F12 — Device Linking
> *"Connect multiple Calendars across rooms (or even households!) so they share information."*
- **Approach:** Pair a screen to a family via a short code; multiple devices share family data;
  a device can be linked to more than one family (cross-household).
- **BE:** `Device`, pairing-code issue/redeem, device-scoped token; `/devices/pair`.
- **FE:** Pairing screen (enter/generate code); device list + management in `/app`.
- **AC:** Two screens paired to one family stay in sync; unpair works; cross-household link supported.
- *Phase 8*

### F13 — Share Access
> *"Invite your spouse, co-parenting partner, kids, and close friends to access your Calendar."*
- **Approach:** Our own email/link invitations to join a family with a chosen role; the invitee
  authenticates with **Clerk**, then the accept flow creates a Membership. Co-parenting = same user in
  two families.
- **BE:** `Invitation` model, `/invitations` (create/accept/revoke), role assignment.
- **FE:** Invite UI (role picker), pending invites, accept-invite landing.
- **AC:** An invited person joins with the right role and sees shared data; revoke removes access.
- *Phase 1*

---

## Calendar Plus features ⭐

### F14 — Rewards ⭐
> *"Motivate kids to finish tasks with star-powered incentives."*
- **Approach:** Completing tasks awards **stars**; a reward catalog lets kids redeem stars (with
  parent approval).
- **BE:** `Reward`, `StarBalance`, `Redemption`; award hook on `TaskCompletion`; `/rewards`,
  `/rewards/redeem`.
- **FE:** Star balance per child, reward shop, redeem + approve flow, celebratory UI.
- **AC:** Finishing a chore adds stars; redeeming deducts them and notifies a parent for approval.
- *Phase 5*

### F15 — Meal Planning ⭐
> *"Plan breakfast, lunch, dinner, snacks and add them to the calendar… upload/input recipes, create new ones with Smart tech."*
- **Approach:** Weekly meal grid (4 slots/day) referencing recipes or free text; planned meals can
  surface on the calendar. Recipe library with manual entry/upload; AI generation in F17/Phase 6.
- **BE:** `MealPlan`, `Recipe`; `/mealplans`, `/recipes`; option to project meals as calendar items.
- **FE:** Weekly meal planner board, recipe library + detail, "add to calendar".
- **AC:** Assign dinner for a week; recipes saved/edited; meals optionally show on the calendar.
- *Phase 5 (AI recipe gen lands with Phase 6)*

### F16 — Photo Screensaver ⭐
> *"Display favorite photos when idle… organize into albums to choose what's featured."*
- **Approach:** Upload photos into albums; when the device is idle, run a slideshow from selected
  albums. Albums mark which are "featured".
- **BE:** `Album`, `Photo`, file storage + thumbnails; `/albums`, `/photos` (upload).
- **FE:** Album manager + uploader in `/app`; idle-detection slideshow on `/device`.
- **AC:** Upload to an album, mark featured; device idle → smooth slideshow of those photos.
- *Phase 5*

### F17 — Magic Import 🤖⭐
> *"Forward emails and PDFs, or upload photos of lists/flyers to automatically add dates and details."*
- **Approach:** Ingest via email-forwarding address / PDF / image upload → **OCR/text extraction** →
  **DeepSeek** structured extraction → **draft events/list items** the user reviews & confirms.
  (DeepSeek is text-first, so OCR feeds it text — see PLAN §2.)
- **BE:** `MagicImportJob`; ingest endpoints (`/magic-import` upload + inbound-email webhook);
  OCR stage (PDF text/Tesseract); `ai/provider.py` (DeepSeek) → strict JSON drafts; confirm → create.
- **FE:** Upload/forward UI; "review extracted events" screen with edit-before-save.
- **AC:** A flyer photo yields a correctly-dated draft event the user can tweak and save.
- *Phase 6*

---

## External calendar sync 🔌 (Phase 7)

> *"Seamlessly Auto-Syncs With: Google, Outlook, Apple, Cozi, Yahoo."* Built last and incrementally;
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

## Feature → phase index

| Phase | Features |
|------:|----------|
| 0 | F00*, F03 (shell), F24 (scaffold) |
| 1 | F00, F02, F10, F13 |
| 2 | F23, F24, F06, F07, F08, F02 |
| 3 | F01 |
| 4 | F04, F05 |
| 5 | F14, F15, F16 |
| 6 | F17, F15 (AI recipes) |
| 7 | F18, F19, F20, F21, F22, F25 |
| 8 | F09, F11, F12 |
| 9 | notifications, offline, a11y, deploy (cross-cutting) |

*\* foundational scaffolding begins in Phase 0, completed in Phase 1.*
