# MySkylight — Master Plan

A self-hosted clone of the **Skylight Family Calendar** (Calendar Max): a WiFi-connected
touchscreen "hub of the home" plus a companion mobile app, backed by our own API.

> **Status:** Active implementation. Phase 0 (foundations) and much of Phases 1–2 (identity & family,
> calendar core) are built across **both** surfaces; later phases not started.
> See [TRACKER.md](./TRACKER.md) for live progress and [FEATURES.md](./FEATURES.md) for per-feature specs.
>
> **Actual repository layout** (the `MySkylight/` and `MySkylightBackend/` names below are the original
> single-repo design; the code currently lives split across two existing repos):
> - **Backend** → `HomeServerAPI/skylight-api/` (FastAPI app, shares the home-server repo). Runs on port `8001`.
> - **Frontend (PWA)** → `SkylightClone/MySkylight/` (Next.js 16 app: shell, Clerk auth, family/members,
>   and the calendar views/components are scaffolded). The granular FE build checklist + conventions that
>   used to live in `SkylightClone/{Plan,Tracker,Features}.md` have been **folded into**
>   [TRACKER.md](./TRACKER.md) Appendices A–B; those root files are now thin pointers to this `docs/` set.

---

## 1. Product vision

One shared family system that runs in two surfaces from a **single PWA codebase**:

- **Device view** (`/device`) — the same PWA installed in **standalone/fullscreen mode** on a
  wall-mounted screen (tablet, old laptop, Raspberry Pi + display). Always-on, glanceable,
  big tap targets, sleep/wake schedule, photo screensaver when idle.
- **Companion app** (`/app`) — the same PWA installed on phones and tablets for on-the-go updates.

There is no separate native app or separate codebase — one Next.js app serves both surfaces.
Both talk to one **FastAPI + SQLite** backend. Changes on a phone appear on the wall screen in near real-time.

---

## 2. Scope & key decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Mobile strategy | **Responsive Next.js + PWA** (one app, `/device` + `/app`) | One codebase/deploy; installable on phones; native app can come later. |
| D2 | External calendar sync | **Internal-first**; later phase adds **read-only pull** from Google + Apple/iCloud (+ ICS). No write-back. | Fastest path to a working product; read-only sidesteps the heaviest, riskiest work (two-way push, conflict resolution). Outlook/Cozi/Yahoo descoped. |
| D3 | AI / Smart features | **DeepSeek** (OpenAI-compatible API) | Used for Magic Import parsing + smart recipe generation. Behind a thin provider interface so it's swappable. |
| D4 | Authentication | **Clerk** (identity only) | Clerk owns login, sessions, social/MFA. Backend verifies Clerk JWTs; **Family, roles & invitations stay in our DB** (we did *not* adopt Clerk Organizations). |

### Decision notes
- **DeepSeek is text-first.** `api.deepseek.com` exposes `deepseek-chat` (V3) and
  `deepseek-reasoner` (R1) — both text. **Magic Import** (photos/PDFs/flyers) therefore needs an
  **OCR/extraction pre-stage** (PDF text via `pypdf`; scanned images/photos via an OCR engine such
  as Tesseract/PaddleOCR) → then DeepSeek does the structured event extraction. The LLM layer is
  isolated behind one interface (`ai/provider.py`) so a vision model can be swapped in later. Revalidate
  DeepSeek's vision support when Phase 6 starts.
- **Clerk handles identity only.** Clerk authenticates individual users (email, social, MFA, sessions).
  Our backend is a **resource server**: it verifies Clerk-issued JWTs via Clerk's **JWKS** (networkless) and
  maps the `sub` (Clerk user id) to our `User`. User lifecycle syncs through **Clerk webhooks** (Svix-verified
  `user.created/updated/deleted`) with just-in-time provisioning as a fallback. **Family, Membership,
  Invitation, and roles remain in our SQLite DB** — Share Access (F13) is our own invite flow. The
  **device/kiosk keeps its own pairing-code token** (not a Clerk session). No passwords are stored.
  - *Implementation note:* two **local, non-Clerk PINs** were added on top of this: an optional **family
    lock PIN** (`Family.lock_pin_hash`) and an optional **child PIN** (`Member.pin_hash`), both stored only
    as **HMAC-SHA256 digests** peppered with `PIN_PEPPER`. These gate kiosk actions; they are not auth
    credentials and never reach Clerk.

---

## 3. Tech stack

### Frontend — `MySkylight/` (Next.js 16, React 19) — *actual location: `SkylightClone/`*
- **Next.js 16 App Router** + **TypeScript**. ⚠️ This is a newer Next.js with breaking changes —
  consult `node_modules/next/dist/docs/` before writing routing/data code (see `AGENTS.md`).
- **Tailwind v4** + **shadcn/ui** + **radix-ui** + **lucide-react** + **next-themes** (already installed).
- **Clerk** (`@clerk/nextjs`): `<ClerkProvider>`, `clerkMiddleware` route protection,
  `<SignIn>/<SignUp>/<UserButton>`, `auth()`/`currentUser()` server helpers. The Clerk session token is
  attached to every backend request.
- **TanStack Query** for server state/caching; **react-hook-form** + **zod** for forms/validation.
- **Realtime client**: SSE subscription so the device live-updates. SSE drops when the PWA is
  backgrounded on iOS — the subscription hook must reconnect on `visibilitychange`.
- **PWA**: web app manifest + service worker (offline shell, asset caching, installability).
  On **Android**: native install banner via `beforeinstallprompt`.
  On **iOS**: manual "Add to Home Screen" from Safari's share menu; detect with `navigator.standalone`.
  **Web Push on iOS** requires the PWA to be installed to the home screen (iOS 16.4+).
- **Calendar UI**: custom touch-friendly grid (day/week/month/schedule) — avoids heavyweight libs
  and gives us full control of the kiosk aesthetic.

### Backend — `MySkylightBackend/` (FastAPI) — *actual location: `HomeServerAPI/skylight-api/`*
- **FastAPI** + **Pydantic v2**, **Uvicorn**.
- **SQLite** via **SQLAlchemy 2.0** (async) + **Alembic** migrations.
- **Auth**: **Clerk** for identity. Backend verifies Clerk JWTs via **JWKS** (networkless) and maps the
  Clerk user id → our `User`; user sync via **Clerk webhooks** (`svix` signature verification). No passwords
  stored. **Device pairing** tokens remain app-managed.
- **Realtime**: FastAPI **SSE/WebSocket** broadcast per family.
- **Scheduling**: **APScheduler** for reminders, sleep-mode toggles, weather refresh, countdown
  rollovers, and (later) external-sync polling.
- **Files**: local filesystem for photo uploads (screensaver), abstracted behind a storage
  interface for an S3-compatible backend later.
- **AI**: DeepSeek via the OpenAI-compatible SDK, behind `ai/provider.py`.
- **Recurrence**: `python-dateutil` (RRULE) + `icalendar` for `.ics` import/export.
- **Testing**: `pytest` + `httpx` async client.

### Cross-cutting
- **Realtime contract**: server emits typed events (`event.created`, `task.completed`,
  `list.updated`, …) on a per-family channel; clients reconcile via TanStack Query cache.
- **Config**: `.env` (backend) + `NEXT_PUBLIC_*` (frontend). No secrets committed.
- **Deployment**: Docker Compose (api + static export/Node server) target; runs fine on a NUC/Pi/home server.

---

## 4. System architecture

```
            ┌──────────────────────── MySkylight (Next.js PWA) ───────────────────────┐
            │                                                                          │
   Wall screen ──►  /device  (kiosk: calendar, chores, lists, screensaver, sleep)      │
   Phone/tablet ─►  /app     (companion: quick add, profiles, lists, photos, settings) │
            │                       │  REST (TanStack Query)   ▲  SSE / WebSocket       │
            └───────────────────────┼──────────────────────────┼───────────────────────┘
                                    ▼                          │ (live push per family)
            ┌──────────────────────────── MySkylightBackend (FastAPI) ─────────────────┐
            │  Routers: auth · families · members · devices · calendars · events ·      │
            │           tasks · routines · lists · rewards · mealplans · recipes ·      │
            │           photos · albums · weather · sync · magic-import · settings      │
            │                                                                           │
            │  Services: AuthN/Z · Recurrence(RRULE) · Realtime bus · Scheduler ·       │
            │            Storage · Weather client · AI(DeepSeek) · Sync engine(later)   │
            │                                                                           │
            │  Data: SQLAlchemy + Alembic  ──►  SQLite                                   │
            └───────────────────────────────────────────────────────────────────────────┘
                         │ external (Phase 6/7)        │
                         ▼                             ▼
     Clerk (identity·JWT·webhooks) · DeepSeek/OCR · Google·Apple/iCloud (read-only) · Weather
```

### Multi-tenancy & auth model
- **Family (household)** is the tenant boundary. All core data is family-scoped.
- **Identity = Clerk.** Users sign in through Clerk (email, social, MFA). The backend verifies the Clerk
  JWT on every request (JWKS, networkless) and resolves it to a local **`User`** (keyed by `clerk_user_id`,
  no password stored). Clerk **webhooks** keep `User` in sync; JIT provisioning covers first-touch.
- A user can belong to **multiple families** via **Membership** (covers co-parenting / shared access across
  households) — Membership, roles, and invitations live in **our DB**, not Clerk Organizations.
- **Roles** per membership: `owner`, `adult`, `child`, `viewer`. Drives permissions.
- **Devices** authenticate via a **pairing code** + device token (not Clerk) and carry their own settings
  (sleep schedule, orientation, default view) — this powers **Device Linking**.

---

## 5. Data model (core entities)

```
Family 1───* Membership *───1 User
Family 1───* Member            (a person shown on the calendar; may or may not have a User login)
Family 1───* Invitation        (pending invite; optional member_id → claim an existing Member on accept)
Family 1───* Device            (linked screen; settings: sleep, orientation, default view)
Family 1───* Calendar 1───* Event
Event  *───* Member            (assignment → color coding)          [EventAssignment]
Event  1───* Reminder
Event  1───0..1 Countdown
Calendar 0..1─ ExternalAccount (provider tokens/sync state)         [Phase 7]
Family 1───* Task 1───* TaskCompletion
Task   *───* Member            (chore assignment; fixed or rotating roster — F27)  [TaskAssignment(order)]
Member 1───* Routine 1───* Task        (named checklist: "morning", "bedtime")
Family 1───* List 1───* ListItem       (groceries / to-dos)
Family 1───* Reward ;  Member 1─ StarBalance ;  Reward 1───* Redemption
Family 1───* MealPlan *───0..1 Recipe ;  Family 1───* Recipe 1───* RecipeIngredient  (qty/unit/name → grocery aggregation, F28)
Family 1───* Album 1───* Photo
Family 1───* WeatherCache              (by location)
Family 1───* MagicImportJob            (AI ingestion + extracted drafts)  [Phase 6]
Family 1───* AuditLog                  (share-access trail)
```

Key design points:
- **`User`** is keyed by **`clerk_user_id`** (no credentials stored locally); Clerk webhooks upsert it.
  `Member` (a calendar persona shown on the calendar) is distinct from `User` (a real Clerk login).
- **Recurrence** stored as **RRULE** on `Event` with per-occurrence **overrides/exceptions**
  (edit-this / edit-following / edit-all). `TaskCompletion` is logged **per occurrence** so chores
  and routines track streaks without exploding rows.
- **Rotating chores (F27):** a recurring `Task` can rotate through an ordered member roster; the
  per-occurrence assignee is computed deterministically from the occurrence index (`roster[i % n]`),
  so no per-day assignee rows are stored and every device agrees.
- **Recipe → grocery (F28):** `Recipe` ingredients are **structured** (qty/unit/name) so a meal plan
  or a set of recipes can be aggregated (summing/merging like items) into grocery `ListItem`s.
- **Color** resolves in priority order: event override → assigned member color → calendar color.
- **Soft delete + AuditLog** so shared-household edits are traceable.

### Implementation cheat-sheet — load-bearing FKs & invariants

The map above is *conceptual*; these are the exact names/rules you need to actually write code, so you
don't have to reverse-engineer them. **Source of truth = `HomeServerAPI/skylight-api/app/models/*.py`** —
this table just saves you the dig.

| Concern | Where it lives | The load-bearing detail |
|---|---|---|
| Tenant scope | `family_id` on every core table | `Family` is the boundary — filter by it on every query. |
| Profile ↔ login | `Member.user_id` → `User.id`, **nullable** | A `Member` (persona) can exist with **no** login. `Member` ≠ `User`. This is the linchpin for "pre-make a profile, attach a login later." |
| Persona provisioning | `app/services/members.py::ensure_member_for_user` | Idempotent; one `Member` per `User` per family. Called on family-create (owner) + invite-accept. |
| Claim a profile via invite | `Invitation.member_id` (nullable, F13) | When set, accept *claims* that unclaimed `Member` (sets its `user_id`) instead of creating a duplicate — so its chore assignments carry over. |
| Chore assignment | `TaskAssignment(task_id, member_id, sort_order)` | Chores attach to **`member_id`**, never to a `User`. `sort_order` = rotation roster order (F27). |
| Chore completion | `TaskCompletion(task_id, member_id, occurrence_date)` (unique) | One row per member per occurrence date; tracks streaks without exploding rows. |
| Rotation override | `TaskRotationOverride(task_id, occurrence_date, member_id?)` (F27) | Per-occurrence swap; `member_id` NULL = skip ("not my week"). |
| Soft delete | `deleted_at` via `SoftDeleteMixin` (most tables) | Rows are **never** hard-deleted — **always** filter `deleted_at IS NULL` in reads. |
| Recurrence | `rrule` on `Event`/`Task`, anchored at `start_date` | Per-occurrence overrides; rotating assignee computed as `roster[occurrence_index % n]`. |

> **Full schema at a glance:** a generated, always-current SQL dump of every table + index lives at
> **`HomeServerAPI/skylight-api/docs/schema.sql`** (built from the migration chain; regenerate with
> `make schema`). Read it when you need exact column types/constraints without opening each model.

---

## 6. API surface (REST `/api/v1`, + realtime channel)

`me` · `webhooks/clerk` · `families` · `memberships` · `members` · `invitations` · `devices` (pairing) · `calendars` · `events`
(+`/occurrences`) · `reminders` · `tasks` (+rotating assignment, F27) · `routines` · `lists` · `list-items` · `rewards`
(+`/redemptions`) · `mealplans` · `recipes` (+`recipe-ingredients`) · `grocery/from-mealplan` · `grocery/from-recipes` *(F28)* ·
`albums` · `photos` · `weather` · `settings` ·
`magic-import` *(Phase 6)* · `sync` *(Phase 7)*. _(`instacart` was planned for Phase 4 but is **descoped**.)_

Realtime: `GET /api/v1/stream` (SSE) or `WS /api/v1/ws` — authenticated, scoped to a family,
emits typed change events for live device updates.

---

## 7. Phased roadmap

Each phase is independently shippable and has an **exit criteria**. Detailed task breakdowns live in
[TRACKER.md](./TRACKER.md); feature specs in [FEATURES.md](./FEATURES.md).

| Phase | Theme | Delivers | Exit criteria |
|------:|-------|----------|---------------|
| **0** | Foundations | Repo wiring, FastAPI skeleton, DB+migrations, Next.js shell, API client, **Clerk wiring (both ends)**, CI, PWA manifest | `GET /health` green; `/device` & `/app` routes render; one model migrates; tests run. |
| **1** | Identity & family | **Clerk** sign-in + JWT verification + user-sync webhooks, Family setup, Members + colors + avatars, **Share Access** (invites) | Two Clerk users share one family with correct roles. |
| **2** | Calendar core ⭐ | Calendars, Events CRUD, **recurrence**, reminders, member assignment (**color coding**), **Day/Week/Month/Schedule views**, realtime live-update, **Weather**, **Event Countdowns** | Create a recurring event on phone → appears on device instantly with correct color + weather; countdown ticks. |
| **3** | Tasks & routines | **Tasks Manager**: chores/tasks, assignment, recurring chores, **Routines** (morning/bedtime checklists), completion + streaks | A kid checks off a morning routine on the device; parent sees it on mobile. |
| **4** | Lists & groceries | **Custom Lists** (to-dos/groceries), items, check/categorize/assign. _(Grocery → Instacart **descoped**.)_ | Shared grocery list edits sync across surfaces. |
| **5** | Calendar Plus I | **Rewards** (star economy), **Rotating Chores** (F27, auto-rotate assignee), **Meal Planning** (slots → calendar), **Recipes** (manual/upload, structured ingredients), **Recipe → Grocery** (F28, aggregated list), **Photo Screensaver** (albums, idle slideshow) | Stars awarded on chore completion + redeemed; a rotating chore cycles members daily; meals show on calendar; a meal plan builds an aggregated grocery list; idle device shows album slideshow. |
| **6** | Smart / AI | **Magic Import** (email/PDF/photo → OCR → DeepSeek → draft events → confirm), **Smart recipe** generation | Forwarded flyer becomes a reviewed, saved event; recipe generated from a prompt. |
| **7** | External sync | **ICS import/export** (F25, ✅) + **read-only pull** from **Google** (API) and **Apple/iCloud** (CalDAV) to display in-app. _(Outlook/Cozi/Yahoo descoped; write-back descoped — read-only only.)_ | A Google/iCloud event appears in MySkylight read-only; a calendar imports/exports as `.ics`. |
| **8** | Device & system | **Device Linking** (pairing, multi-screen), **Sleep Mode**, orientation, default views | Two paired screens share data; screen sleeps/wakes on schedule. |
| **9** | Polish & hardening | Web **push notifications** + reminder delivery, offline/PWA caching, a11y, kiosk wake-lock, perf, backups, deploy | Reminder fires as a push; app usable offline; Lighthouse PWA passes; one-command deploy. |

> Weather and Countdowns ride with Phase 2 because they attach to events. Instacart (the Phase-4
> Grocery hand-off) is **descoped** — not used. Sync is deliberately late (Phase 7).
>
> **Phase 7 scope (decided 2026-06-15):** keep **F25** (ICS, done), **F18** (Google), **F20** (Apple/iCloud);
> **descope F19 (Outlook), F21 (Cozi), F22 (Yahoo)** — not used by this household. Sync is **read-only
> (one-way pull)**: external events are mirrored in to display; MySkylight **never writes back**. This
> removes two-way push, conflict resolution, and write-back from the phase.

---

## 8. Cross-cutting concerns

- **Security**: **Clerk** owns credentials, sessions, and MFA; the backend verifies Clerk JWTs via JWKS
  and verifies webhook signatures (Svix). Per-family authorization checks on every route, signed device
  pairing codes, secrets only in `.env`. Audit trail for privileged actions.
- **Testing**: pytest for backend (unit + API), Vitest/Playwright for frontend later; seed/factory
  fixtures; recurrence + permission logic get dedicated test suites.
- **Offline/PWA**: service worker caches the app shell + static assets; last-known API data in
  TanStack Query cache; writes queued offline and replayed on reconnect. PWA updates deploy
  automatically — new service worker activates on next navigation (no app store, no reinstall).
- **Accessibility & kiosk**: large tap targets, high-contrast device theme, screen wake-lock,
  prevent accidental navigation in kiosk mode.
- **Observability**: structured logging, request IDs, a simple `/health` + `/version`.
- **Deployment**: Docker Compose; SQLite file on a mounted volume; nightly DB backup task.

---

## 9. Risks & open questions

| Risk / question | Impact | Mitigation |
|---|---|---|
| ~~Cozi has no public API~~ | ~~Can't truly two-way sync~~ | **Descoped (2026-06-15)** — household doesn't use Cozi. (F25's URL `.ics` import remains if ever needed.) |
| **DeepSeek has no public vision API** | Magic Import on photos | OCR pre-stage; keep AI layer swappable; revalidate at Phase 6. |
| ~~Instacart API is partner-gated (US-only)~~ | ~~Grocery 1-tap order~~ | **Descoped** — feature dropped (owner doesn't use Instacart), so the risk no longer applies. |
| **CalDAV quirks (Apple)** | Flaky sync | Use a battle-tested CalDAV client lib. **Read-only only** (write-back descoped 2026-06-15), which sidesteps the riskiest CalDAV write/ETag-conflict paths. (Yahoo descoped.) |
| **Next.js 16 is pre-GA-ish / breaking** | FE churn | Follow bundled docs in `node_modules/next/dist/docs/`; pin versions. |
| **Clerk dependency / pricing / outage** | Auth is third-party | Verify JWTs networklessly (cached JWKS) so brief Clerk outages don't break verified sessions; webhook + JIT user sync; keep identity isolated so it's swappable. |
| **SQLite write concurrency** | Many devices writing | WAL mode; serialize writes; fine for household scale. |
| **iOS Web Push requires home screen install** | Notifications don't work on iOS if PWA not installed | Require "Add to Home Screen" before enabling push; detect `navigator.standalone`; show prompt if not installed. iOS 16.4+ only. |
| **SSE drops on iOS background** | Real-time updates miss while app is backgrounded | Reconnect SSE on `visibilitychange` (foreground event); TanStack Query refetch on focus covers the gap. |
| **No install banner on iOS Safari** | iOS users may not know to install the PWA | Show an in-app "Install" prompt with Add to Home Screen instructions when `navigator.standalone` is false and browser is iOS Safari. |
| Native mobile later? | Re-platform cost | PWA now; API is client-agnostic so RN/Expo can be added without backend changes. |

---

*Living document. Update the decisions table and roadmap as scope evolves; keep
[TRACKER.md](./TRACKER.md) in sync.*
