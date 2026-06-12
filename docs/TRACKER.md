# MySkylight — Implementation Tracker

The single source of truth for **what's done and what's next**. Check items off as you go.
Specs for each `Fxx` ID are in [FEATURES.md](./FEATURES.md); architecture in [PLAN.md](./PLAN.md).

**How to use:** work top-to-bottom by phase. Tick `- [x]` when an item is merged + minimally tested.
Update the **Progress summary** counts when you complete a phase. Tags: `[INFRA]` `[BE]` `[FE]` `[AI]` `[🔌]`.

**Status legend:** ☐ not started · ◐ in progress · ☑ done · ⏸ blocked/parked

---

## Progress summary

| Phase | Theme | Status | Done / Total |
|------:|-------|:------:|:------------:|
| 0 | Foundations | ☐ | 0 / 19 |
| 1 | Identity & family (Clerk) | ☐ | 0 / 18 |
| 2 | Calendar core ⭐ | ☐ | 0 / 22 |
| 3 | Tasks & routines | ☐ | 0 / 11 |
| 4 | Lists & groceries | ☐ | 0 / 11 |
| 5 | Calendar Plus I (rewards/meals/photos) | ☐ | 0 / 18 |
| 6 | Smart / AI (DeepSeek) | ☐ | 0 / 11 |
| 7 | External sync | ☐ | 0 / 16 |
| 8 | Device & system | ☐ | 0 / 13 |
| 9 | Polish & hardening | ☐ | 0 / 12 |
| | **Total** | | **0 / 151** |

---

## Phase 0 — Foundations  `☐`
Goal: both apps boot, talk to each other, and the data/auth/realtime plumbing exists.

**Repo & tooling**
- [ ] `[INFRA]` Initialize git repo at root; add root `.gitignore` (Python, Node, `.env`, `*.db`)
- [ ] `[INFRA]` Add root `README.md` + `docs/` (done) and a `.env.example` for each app
- [ ] `[INFRA]` Decide local dev: run scripts / `docker-compose.yml` (api + web)

**Backend skeleton — `MySkylightBackend/`**
- [ ] `[BE]` FastAPI app factory, settings (pydantic-settings), CORS, `/health`, `/version`
- [ ] `[BE]` SQLAlchemy 2.0 async engine + session; SQLite WAL; base model + mixins (id, timestamps, soft-delete)
- [ ] `[BE]` Alembic configured; first migration; `make`/script to upgrade
- [ ] `[BE]` Project layout: `app/{core,models,schemas,routers,services,deps}`
- [ ] `[BE]` Realtime bus skeleton + `GET /api/v1/stream` (SSE) auth-scoped to family
- [ ] `[BE]` Clerk: env keys (`CLERK_SECRET_KEY`, JWKS URL, webhook secret) + JWT-verification dependency stub (JWKS) + `/webhooks/clerk` skeleton (Svix verify)
- [ ] `[BE]` Pytest + httpx async client; one passing smoke test
- [ ] `[BE]` Structured logging + request IDs

**Frontend shell — `MySkylight/`**
- [ ] `[FE]` Read Next.js 16 docs in `node_modules/next/dist/docs/` before routing/data work
- [ ] `[FE]` Routes: `/device` (kiosk layout) and `/app` (mobile layout) shells render
- [ ] `[FE]` Clerk: `@clerk/nextjs` `<ClerkProvider>` + `clerkMiddleware` + sign-in/up routes; attach session token to API client
- [ ] `[FE]` Typed API client + TanStack Query provider + env (`NEXT_PUBLIC_API_URL`)
- [ ] `[FE]` Design tokens / theme (next-themes), base shadcn components, device vs mobile layouts
- [ ] `[FE]` Realtime subscription hook (SSE) wired to query cache (F24 scaffold)
- [ ] `[FE]` PWA: web manifest + service worker registration (F03 shell)
- [ ] `[FE]` App shell loading/error states; offline fallback page

---

## Phase 1 — Identity & family  `☐`   → F00, F02, F10, F13
Goal: real auth, families, members with colors, sharing, and parental lock.

- [ ] `[BE]` Models: `User` (keyed by `clerk_user_id`, no password), `Family`, `Membership`, `Member` (role, color, avatar, PIN)
- [ ] `[BE]` Clerk JWT verification dependency (JWKS, networkless) → resolve `clerk_user_id` → `User`; `GET /me`
- [ ] `[BE]` `/webhooks/clerk` (Svix-verified `user.created/updated/deleted`) → upsert/soft-delete `User`; JIT provisioning fallback
- [ ] `[BE]` Per-family authorization dependency (role-aware) used by all routers
- [ ] `[BE]` `/families` CRUD + `/members` CRUD (color, avatar, PIN child profiles) — **F02**
- [ ] `[BE]` `Invitation` model + `/invitations` create/accept/revoke (roles) — **F13**
- [ ] `[BE]` Parental Lock: lock state + PIN, mutation guard, `AuditLog` — **F10**
- [ ] `[FE]` Clerk `<SignIn>`/`<SignUp>` + `clerkMiddleware` route protection + `<UserButton>`; attach Clerk token to API client
- [ ] `[FE]` Create-family wizard (post sign-in onboarding)
- [ ] `[FE]` Member management UI: add member, color picker, avatar, child PIN — **F02**
- [ ] `[FE]` Profile switcher (device + mobile)
- [ ] `[FE]` Invite flow: send invite (role), pending list, accept-invite landing — **F13**
- [ ] `[FE]` Parental Lock UI: toggle + PIN prompt before edit/add/delete — **F10**
- [ ] `[BE]` Color-resolution helper (event→member→calendar) — **F02**
- [ ] `[ ] ` Tests: Clerk JWT verification, webhook user-sync, cross-family authz rejection, invite accept, lock enforcement
- [ ] `[ ] ` AC: two Clerk users share one family; child profile PIN-gated
- [ ] `[ ] ` AC: locked family rejects child mutations, accepts parent PIN
- [ ] `[ ] ` Realtime: emit member/family changes

---

## Phase 2 — Calendar core ⭐  `☐`   → F23, F24, F06, F07, F08, F02
Goal: the heart — recurring events, four views, color, weather, countdowns, live updates.

**Events engine — F23**
- [ ] `[BE]` Models: `Calendar`, `Event`, `EventAssignment`, `Reminder`
- [ ] `[BE]` RRULE recurrence (`python-dateutil`) + per-occurrence overrides/exceptions
- [ ] `[BE]` `/calendars`, `/events` CRUD; `/events/{id}/occurrences?from&to`
- [ ] `[BE]` Edit modes: this-occurrence / this-and-following / all
- [ ] `[BE]` Member assignment on events (multi) → color coding — **F02**
- [ ] `[BE]` Reminders persisted (delivery in Phase 9)
- [ ] `[FE]` Event create/edit sheet (title, time, all-day, location, repeat, members, color, reminder)
- [ ] `[FE]` Color rendering across views (dots/bars, multi-assignee) — **F02**

**Views — F06**
- [ ] `[FE]` Day view (timeline, touch)
- [ ] `[FE]` Week view
- [ ] `[FE]` Month view
- [ ] `[FE]` Schedule (agenda list) view
- [ ] `[FE]` View toggle + remember per-device default

**Realtime — F24**
- [ ] `[BE]` Emit `event.*` on mutations to family channel
- [ ] `[FE]` Subscribe + reconcile cache; device updates ≤ ~1s
- [ ] `[ ] ` AC: phone-created recurring event appears on device instantly, correct color

**Weather — F07**
- [ ] `[BE]` Weather client (Open-Meteo default) + `WeatherCache` + scheduled refresh; `/weather`
- [ ] `[FE]` Weather strip on day/week; per-event forecast when location+time known

**Countdowns — F08**
- [ ] `[BE]` `Countdown` (flag/model) returned with events
- [ ] `[FE]` Countdown tiles on device home + on event detail

---

## Phase 3 — Tasks & routines  `☐`   → F01
Goal: interactive chores/routines kids can check off; streaks; parental-lock aware.

- [ ] `[BE]` Models: `Task`, `Routine`, `TaskCompletion` (per-occurrence)
- [ ] `[BE]` Recurring chores via RRULE engine; assignment to members
- [ ] `[BE]` `/tasks`, `/routines`, `/tasks/{id}/complete` (+ undo); streak calc
- [ ] `[BE]` Respect Parental Lock on task mutations
- [ ] `[FE]` Per-member checklist cards on `/device` (big tap targets, completion animation)
- [ ] `[FE]` Task/routine management in `/app`
- [ ] `[FE]` Routine builder (group tasks into morning/bedtime, ordered)
- [ ] `[FE]` Streak/habit indicator
- [ ] `[BE]` Realtime: emit `task.*`
- [ ] `[ ] ` Tests: completion, daily reset, streak, recurrence
- [ ] `[ ] ` AC: kid checks a morning routine on device; parent sees it on mobile

---

## Phase 4 — Lists & groceries  `☐`   → F04, F05
Goal: shared lists + Instacart hand-off.

- [ ] `[BE]` Models: `List`, `ListItem` (text, qty, category, checked, assignee)
- [ ] `[BE]` `/lists`, `/list-items` CRUD + reorder; list types (todo/grocery)
- [ ] `[BE]` Realtime: emit `list.*`
- [ ] `[FE]` List screens (device + mobile): quick-add, check/uncheck, categories, reorder
- [ ] `[FE]` Shared live edits across surfaces
- [ ] `[BE]` `[🔌]` Instacart: API integration **or** deep-link/affiliate fallback; region flag — **F05**
- [ ] `[FE]` `[🔌]` "Send to Instacart" on grocery lists; disabled/explained outside US — **F05**
- [ ] `[ ] ` Tests: list CRUD, concurrent check sync
- [ ] `[ ] ` AC: grocery edits sync live across device + mobile
- [ ] `[ ] ` AC: Instacart hand-off works or degrades gracefully
- [ ] `[ ] ` Research: confirm Instacart API access / fallback approach (spike)

---

## Phase 5 — Calendar Plus I  `☐`   → F14, F15, F16
Goal: rewards economy, meal planning + recipes, photo screensaver.

**Rewards — F14**
- [ ] `[BE]` Models: `Reward`, `StarBalance`, `Redemption`; award hook on `TaskCompletion`
- [ ] `[BE]` `/rewards`, `/rewards/redeem` (+ parent approval)
- [ ] `[FE]` Star balance per child, reward shop, redeem + approval, celebratory UI

**Meal planning & recipes — F15**
- [ ] `[BE]` Models: `MealPlan` (date, slot), `Recipe` (ingredients, steps, image, tags)
- [ ] `[BE]` `/mealplans`, `/recipes`; project meals onto calendar (optional)
- [ ] `[FE]` Weekly meal planner board (breakfast/lunch/dinner/snack)
- [ ] `[FE]` Recipe library + detail + manual entry/upload
- [ ] `[FE]` "Add meal to calendar"

**Photo screensaver — F16**
- [ ] `[BE]` Models: `Album`, `Photo`; storage interface + thumbnail generation
- [ ] `[BE]` `/albums`, `/photos` (upload, featured flag)
- [ ] `[FE]` Album manager + uploader in `/app`
- [ ] `[FE]` Idle detection + slideshow on `/device` from featured albums
- [ ] `[BE]` Realtime: emit `reward.*`, `mealplan.*`, `photo.*`
- [ ] `[ ] ` Tests: star award/redeem math, meal→calendar, upload pipeline
- [ ] `[ ] ` AC: chore completion awards stars; redeem needs approval
- [ ] `[ ] ` AC: idle device shows album slideshow; meals appear on calendar

---

## Phase 6 — Smart / AI (DeepSeek)  `☐`   → F17, F15(AI)
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

## Phase 7 — External calendar sync 🔌  `☐`   → F18–F22, F25
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

## Phase 8 — Device & system  `☐`   → F12, F09, F11
Goal: pairing/multi-screen, sleep schedule, auto-updates.

- [ ] `[BE]` `Device` model + settings (sleep window, orientation, default view)
- [ ] `[BE]` Pairing: issue/redeem short code, device-scoped token; `/devices/pair` — **F12**
- [ ] `[FE]` Pairing screen (generate/enter code) + device list/management in `/app` — **F12**
- [ ] `[ ] ` AC: two paired screens share data; unpair works; cross-household link
- [ ] `[BE]` Sleep schedule + scheduler emits sleep/wake; `/devices/{id}/settings` — **F09**
- [ ] `[FE]` Sleep overlay on `/device` (clock/blank) + wake-lock; settings UI — **F09**
- [ ] `[ ] ` AC: device sleeps/wakes on schedule, per device
- [ ] `[FE]` Orientation (landscape/portrait) + default-view settings
- [ ] `[BE]` `/version` + optional release-notes feed — **F11**
- [ ] `[FE]` SW update lifecycle (skipWaiting/clientsClaim) + "update ready" auto-apply — **F11**
- [ ] `[ ] ` AC: new deploy auto-updates device without reinstall
- [ ] `[BE]` Realtime: emit `device.*` (settings/sleep)
- [ ] `[ ] ` Tests: pairing, sleep scheduling, settings scope

---

## Phase 9 — Polish & hardening  `☐`
Goal: notifications, offline, accessibility, performance, deploy.

- [ ] `[FE]` Web Push subscription + permission flow
- [ ] `[BE]` Push delivery for reminders + scheduler wiring (delivers Phase 2 reminders)
- [ ] `[FE]` Offline PWA: cache shell + last data; queue writes + replay on reconnect
- [ ] `[FE]` Accessibility pass (contrast, focus, tap targets, screen-reader labels)
- [ ] `[FE]` Kiosk hardening: wake-lock, prevent stray navigation, fullscreen
- [ ] `[BE]` Rate limiting on abuse-sensitive routes + `/webhooks/clerk` (Clerk handles login rate-limiting)
- [ ] `[INFRA]` Nightly SQLite backup task + restore doc
- [ ] `[INFRA]` Docker Compose deploy (api + web) on a mounted volume
- [ ] `[INFRA]` CI: lint + typecheck + tests on push
- [ ] `[FE]` Performance: Lighthouse PWA pass, image/thumbnail optimization
- [ ] `[ ] ` End-to-end smoke across device + mobile
- [ ] `[ ] ` Docs: deploy guide, env reference, backup/restore

---

### Notes / parking lot
- Native mobile (Expo/React Native) deferred — PWA first; API stays client-agnostic (PLAN §9).
- Instacart, DeepSeek vision, and Cozi each have a research spike before their phase — keep
  expectations realistic and ship graceful fallbacks.
