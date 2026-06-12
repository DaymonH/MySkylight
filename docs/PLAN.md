# MySkylight — Master Plan

A self-hosted clone of the **Skylight Family Calendar** (Calendar Max): a WiFi-connected
touchscreen "hub of the home" plus a companion mobile app, backed by our own API.

> **Status:** Planning complete. Implementation not yet started.
> See [TRACKER.md](./TRACKER.md) for live progress and [FEATURES.md](./FEATURES.md) for per-feature specs.

---

## 1. Product vision

One shared family system that runs in two surfaces from a single codebase:

- **Device view** (`/device`) — a full-screen, landscape, touch-first "kiosk" that lives on a
  wall-mounted screen (tablet, old laptop, Raspberry Pi + display). Always-on, glanceable,
  big tap targets, sleep/wake schedule, photo screensaver when idle.
- **Companion app** (`/app`) — a mobile-responsive, installable **PWA** for on-the-go updates.

Both talk to one **FastAPI + SQLite** backend. Changes on a phone appear on the wall screen
in near real-time.

---

## 2. Scope & key decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Mobile strategy | **Responsive Next.js + PWA** (one app, `/device` + `/app`) | One codebase/deploy; installable on phones; native app can come later. |
| D2 | External calendar sync | **Internal-first**, external providers in a later phase | Fastest path to a working product; sync (esp. Cozi/CalDAV) is the heaviest, riskiest work. |
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
  **device/kiosk keeps its own pairing-code token** (not a Clerk session).

---

## 3. Tech stack

### Frontend — `MySkylight/` (Next.js 16, React 19)
- **Next.js 16 App Router** + **TypeScript**. ⚠️ This is a newer Next.js with breaking changes —
  consult `node_modules/next/dist/docs/` before writing routing/data code (see `AGENTS.md`).
- **Tailwind v4** + **shadcn/ui** + **radix-ui** + **lucide-react** + **next-themes** (already installed).
- **Clerk** (`@clerk/nextjs`): `<ClerkProvider>`, `clerkMiddleware` route protection,
  `<SignIn>/<SignUp>/<UserButton>`, `auth()`/`currentUser()` server helpers. The Clerk session token is
  attached to every backend request.
- **TanStack Query** for server state/caching; **react-hook-form** + **zod** for forms/validation.
- **Realtime client**: SSE (or WebSocket) subscription so the device live-updates.
- **PWA**: web app manifest + service worker (offline shell, installability, auto-update).
- **Calendar UI**: custom touch-friendly grid (day/week/month/schedule) — avoids heavyweight libs
  and gives us full control of the kiosk aesthetic.

### Backend — `MySkylightBackend/` (FastAPI)
- **FastAPI** + **Pydantic v2**, **Uvicorn**.
- **SQLite** via **SQLAlchemy 2.0** (async) + **Alembic** migrations.
- **Auth**: **Clerk** for identity. Backend verifies Clerk JWTs via **JWKS** (networkless) and maps the
  Clerk user id → our `User`; user sync via **Clerk webhooks** (`svix` signature verification). No passwords
  stored. Child **PIN** profiles and **device pairing** tokens remain app-managed.
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
     Clerk (identity·JWT·webhooks) · DeepSeek/OCR · Google·Outlook·Apple·Yahoo·Cozi · Weather · Instacart
```

### Multi-tenancy & auth model
- **Family (household)** is the tenant boundary. All core data is family-scoped.
- **Identity = Clerk.** Users sign in through Clerk (email, social, MFA). The backend verifies the Clerk
  JWT on every request (JWKS, networkless) and resolves it to a local **`User`** (keyed by `clerk_user_id`,
  no password stored). Clerk **webhooks** keep `User` in sync; JIT provisioning covers first-touch.
- A user can belong to **multiple families** via **Membership** (covers co-parenting / shared access across
  households) — Membership, roles, and invitations live in **our DB**, not Clerk Organizations.
- **Roles** per membership: `owner`, `adult`, `child`, `viewer`. Drives permissions + **Parental Lock**.
- **Child profiles** can be PIN-gated (lightweight, kid-friendly) rather than full Clerk logins.
- **Devices** authenticate via a **pairing code** + device token (not Clerk) and carry their own settings
  (sleep schedule, orientation, default view) — this powers **Device Linking**.

---

## 5. Data model (core entities)

```
Family 1───* Membership *───1 User
Family 1───* Member            (a person shown on the calendar; may or may not have a User login)
Family 1───* Device            (linked screen; settings: sleep, orientation, default view)
Family 1───* Calendar 1───* Event
Event  *───* Member            (assignment → color coding)          [EventAssignment]
Event  1───* Reminder
Event  1───0..1 Countdown
Calendar 0..1─ ExternalAccount (provider tokens/sync state)         [Phase 7]
Family 1───* Task 1───* TaskCompletion
Member 1───* Routine 1───* Task        (named checklist: "morning", "bedtime")
Family 1───* List 1───* ListItem       (groceries / to-dos)
Family 1───* Reward ;  Member 1─ StarBalance ;  Reward 1───* Redemption
Family 1───* MealPlan *───0..1 Recipe ;  Family 1───* Recipe
Family 1───* Album 1───* Photo
Family 1───* WeatherCache              (by location)
Family 1───* MagicImportJob            (AI ingestion + extracted drafts)  [Phase 6]
Family 1───* AuditLog                  (parental lock / share-access trail)
```

Key design points:
- **`User`** is keyed by **`clerk_user_id`** (no credentials stored locally); Clerk webhooks upsert it.
  `Member` (a calendar persona — possibly a PIN-only kid) is distinct from `User` (a real Clerk login).
- **Recurrence** stored as **RRULE** on `Event` with per-occurrence **overrides/exceptions**
  (edit-this / edit-following / edit-all). `TaskCompletion` is logged **per occurrence** so chores
  and routines track streaks without exploding rows.
- **Color** resolves in priority order: event override → assigned member color → calendar color.
- **Soft delete + AuditLog** so Parental Lock and shared-household edits are traceable.

---

## 6. API surface (REST `/api/v1`, + realtime channel)

`me` · `webhooks/clerk` · `families` · `memberships` · `members` · `invitations` · `devices` (pairing) · `calendars` · `events`
(+`/occurrences`) · `reminders` · `tasks` · `routines` · `lists` · `list-items` · `rewards`
(+`/redemptions`) · `mealplans` · `recipes` · `albums` · `photos` · `weather` · `settings` ·
`magic-import` *(Phase 6)* · `sync` *(Phase 7)* · `instacart` *(Phase 4, US)*.

Realtime: `GET /api/v1/stream` (SSE) or `WS /api/v1/ws` — authenticated, scoped to a family,
emits typed change events for live device updates.

---

## 7. Phased roadmap

Each phase is independently shippable and has an **exit criteria**. Detailed task breakdowns live in
[TRACKER.md](./TRACKER.md); feature specs in [FEATURES.md](./FEATURES.md).

| Phase | Theme | Delivers | Exit criteria |
|------:|-------|----------|---------------|
| **0** | Foundations | Repo wiring, FastAPI skeleton, DB+migrations, Next.js shell, API client, **Clerk wiring (both ends)**, CI, PWA manifest | `GET /health` green; `/device` & `/app` routes render; one model migrates; tests run. |
| **1** | Identity & family | **Clerk** sign-in + JWT verification + user-sync webhooks, Family setup, Members + colors + avatars, child PIN profiles, **Share Access** (invites), **Parental Lock** | Two Clerk users share one family; a child profile is PIN-gated; locked items reject edits. |
| **2** | Calendar core ⭐ | Calendars, Events CRUD, **recurrence**, reminders, member assignment (**color coding**), **Day/Week/Month/Schedule views**, realtime live-update, **Weather**, **Event Countdowns** | Create a recurring event on phone → appears on device instantly with correct color + weather; countdown ticks. |
| **3** | Tasks & routines | **Tasks Manager**: chores/tasks, assignment, recurring chores, **Routines** (morning/bedtime checklists), completion + streaks | A kid checks off a morning routine on the device; parent sees it on mobile. |
| **4** | Lists & groceries | **Custom Lists** (to-dos/groceries), items, check/categorize/assign, **Grocery → Instacart** (US, with deep-link fallback) | Shared grocery list edits sync across surfaces; "send to Instacart" works or degrades gracefully. |
| **5** | Calendar Plus I | **Rewards** (star economy), **Meal Planning** (slots → calendar), **Recipes** (manual/upload), **Photo Screensaver** (albums, idle slideshow) | Stars awarded on chore completion + redeemed; meals show on calendar; idle device shows album slideshow. |
| **6** | Smart / AI | **Magic Import** (email/PDF/photo → OCR → DeepSeek → draft events → confirm), **Smart recipe** generation | Forwarded flyer becomes a reviewed, saved event; recipe generated from a prompt. |
| **7** | External sync | **Google** → **Outlook** → **Apple/Yahoo (CalDAV)** → **Cozi** (best-effort ICS). Two-way where possible. | A Google event appears in MySkylight and vice-versa; others import read-only. |
| **8** | Device & system | **Device Linking** (pairing, multi-screen), **Sleep Mode**, orientation, default views, **Software Updates** (PWA auto-update channel) | Two paired screens share data; screen sleeps/wakes on schedule; new build auto-applies. |
| **9** | Polish & hardening | Web **push notifications** + reminder delivery, offline/PWA caching, a11y, kiosk wake-lock, perf, backups, deploy | Reminder fires as a push; app usable offline; Lighthouse PWA passes; one-command deploy. |

> Weather and Countdowns ride with Phase 2 because they attach to events. Instacart is isolated in
> Phase 4 (partner-gated; we ship a graceful fallback). Sync is deliberately late (Phase 7).

---

## 8. Cross-cutting concerns

- **Security**: **Clerk** owns credentials, sessions, and MFA; the backend verifies Clerk JWTs via JWKS
  and verifies webhook signatures (Svix). Per-family authorization checks on every route, signed device
  pairing codes, secrets only in `.env`. Audit trail for privileged actions.
- **Testing**: pytest for backend (unit + API), Vitest/Playwright for frontend later; seed/factory
  fixtures; recurrence + permission logic get dedicated test suites.
- **Offline/PWA**: cache the app shell + last-known data; queue writes when offline and replay.
- **Accessibility & kiosk**: large tap targets, high-contrast device theme, screen wake-lock,
  prevent accidental navigation in kiosk mode.
- **Observability**: structured logging, request IDs, a simple `/health` + `/version`.
- **Deployment**: Docker Compose; SQLite file on a mounted volume; nightly DB backup task.

---

## 9. Risks & open questions

| Risk / question | Impact | Mitigation |
|---|---|---|
| **Cozi has no public API** | Can't truly two-way sync | Best-effort `.ics` feed/import only; set expectations in UI. |
| **DeepSeek has no public vision API** | Magic Import on photos | OCR pre-stage; keep AI layer swappable; revalidate at Phase 6. |
| **Instacart API is partner-gated (US-only)** | Grocery 1-tap order | Implement official API if approved; else deep-link/affiliate export fallback. |
| **CalDAV quirks (Apple/Yahoo)** | Flaky sync | Use a battle-tested CalDAV client lib; read-only first. |
| **Next.js 16 is pre-GA-ish / breaking** | FE churn | Follow bundled docs in `node_modules/next/dist/docs/`; pin versions. |
| **Clerk dependency / pricing / outage** | Auth is third-party | Verify JWTs networklessly (cached JWKS) so brief Clerk outages don't break verified sessions; webhook + JIT user sync; keep identity isolated so it's swappable. |
| **SQLite write concurrency** | Many devices writing | WAL mode; serialize writes; fine for household scale. |
| Native mobile later? | Re-platform cost | PWA now; API is client-agnostic so RN/Expo can be added without backend changes. |

---

*Living document. Update the decisions table and roadmap as scope evolves; keep
[TRACKER.md](./TRACKER.md) in sync.*
