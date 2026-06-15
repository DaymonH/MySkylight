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
|     2 | Calendar core ⭐                       |   ◐    |               21 / 24 (FE wiring/AC pending)                |
|     3 | Tasks & routines                       |   ☐    |                           0 / 10                            |
|     4 | Lists & groceries                      |   ☐    |                           0 / 11                            |
|     5 | Calendar Plus I (rewards/meals/photos) |   ☐    |                           0 / 18                            |
|     6 | Smart / AI (DeepSeek)                  |   ☐    |                           0 / 11                            |
|     7 | External sync                          |   ☐    |                           0 / 16                            |
|     8 | Device & system                        |   ☐    |                           0 / 10                            |
|     9 | Polish & hardening                     |   ☐    |                           0 / 15                            |
|       | **Total**                              |        |                        **55 / 148**                         |

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

## Phase 2 — Calendar core ⭐ `◐` (backend + FE views built; FE wiring/AC pending) → F23, F24, F06, F07, F08, F02

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
- [x] `[FE]` View toggle (`components/calendar/calendar-view.tsx` + `components/ui/tabs.tsx`) — _remember-per-device default: verify_
- [x] `[FE]` Configurable visible-hours window on day/week grid (`hooks/use-visible-hours.ts`, `components/settings-dialog.tsx`) — **F26**

**Realtime — F24**

- [x] `[BE]` Emit `event.*` / `calendar.*` on mutations to family channel
- [x] `[FE]` Subscribe + reconcile cache (`hooks/use-realtime.ts`); device updates ≤ ~1s _(verify latency/iOS reconnect)_
- [ ] `[ ] ` AC: phone-created recurring event appears on device instantly, correct color

**Weather — F07**

- [x] `[BE]` Weather client (Open-Meteo default) + `WeatherCache` (on-demand, 1 h TTL); `/families/{id}/weather`
- [x] `[BE]` Scheduled weather refresh (APScheduler) — `services/scheduler.py` re-fetches cached forecasts every `WEATHER_REFRESH_MINUTES` (default 30) so the device stays fresh without a request
- [x] `[FE]` Weather strip (`components/calendar/weather-icon.tsx`, `hooks/use-weather.ts`)

**Countdowns — F08**

- [x] `[BE]` `is_countdown` flag + `days_until` returned with occurrences
- [x] `[FE]` Countdown tiles (`components/calendar/countdown-strip.tsx`)

---

## Phase 3 — Tasks & routines `☐` → F01

Goal: interactive chores/routines kids can check off; streaks.

- [ ] `[BE]` Models: `Task`, `Routine`, `TaskCompletion` (per-occurrence)
- [ ] `[BE]` Recurring chores via RRULE engine; assignment to members
- [ ] `[BE]` `/tasks`, `/routines`, `/tasks/{id}/complete` (+ undo); streak calc
- [ ] `[FE]` Per-member checklist cards on `/device` (big tap targets, completion animation)
- [ ] `[FE]` Task/routine management in `/app`
- [ ] `[FE]` Routine builder (group tasks into morning/bedtime, ordered)
- [ ] `[FE]` Streak/habit indicator
- [ ] `[BE]` Realtime: emit `task.*`
- [ ] `[ ] ` Tests: completion, daily reset, streak, recurrence
- [ ] `[ ] ` AC: kid checks a morning routine on device; parent sees it on mobile

---

## Phase 4 — Lists & groceries `☐` → F04, F05

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

## Phase 5 — Calendar Plus I `☐` → F14, F15, F16

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

---

### Notes / parking lot

- Native mobile (Expo/React Native) deferred — PWA first; API stays client-agnostic (PLAN §9).
- Instacart, DeepSeek vision, and Cozi each have a research spike before their phase — keep
  expectations realistic and ship graceful fallbacks.

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
