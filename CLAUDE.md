# CLAUDE.md — MySkylight Frontend (`SkylightClone`)

Next.js 16 PWA frontend for **MySkylight**, a self-hosted Skylight Family Calendar clone. One PWA
codebase serves two surfaces: **`/device`** (wall-mounted kiosk) and **`/app`** (phone/tablet companion).
The app lives in **`MySkylight/`**; the FastAPI backend is a separate repo (see below).

## ⚠️ Read the canonical docs first
- **`docs/PLAN.md`** — architecture, stack, phased roadmap, decisions
- **`docs/FEATURES.md`** — per-feature specs with stable `Fxx` IDs + acceptance criteria
- **`docs/TRACKER.md`** — phase-by-phase checklist; **Appendix A** = FE granular checklist, **Appendix B** = FE conventions + the *actual* route tree
- **`docs/PERFORMANCE.md`** — perf findings + prioritized plan (cross-repo; 2026-06-25 discovery pass)

> **Touching data shapes / API payloads? Start here, don't reverse-engineer:** read **`docs/PLAN.md`
> §5 (Data model)** + **§6 (API surface)**, then the backend's source-of-truth models at
> **`../../HomeServerAPI/skylight-api/app/models/*.py`** for exact fields. The backend `CLAUDE.md`
> covers the API/auth/realtime contract. For the **exact current endpoint list** (method · path · auth ·
> handler), see the generated **`../../HomeServerAPI/skylight-api/docs/api.md`**.

**When you finish a feature, tick it in `docs/TRACKER.md` and update `docs/FEATURES.md`.** These are the source of truth — keep them current.

> The root `Plan.md` / `Tracker.md` / `Features.md` are **thin pointer stubs** — content was folded into `docs/`.

## Project layout (split across two sibling repos)
```
SkylightClone/MySkylight/           ← YOU ARE HERE (frontend, Next.js 16)
SkylightClone/docs/                 ← canonical PLAN/FEATURES/TRACKER
HomeServerAPI/skylight-api/         ← backend (FastAPI + SQLite, port 8001)
```
Backend canonical docs cross-reference here; its API surface is in `docs/PLAN.md` §6.

## Stack & key conventions
- **Next.js 16 App Router** — newer, breaking changes vs training data. **Read `node_modules/next/dist/docs/` before writing routing/data code** (see `MySkylight/AGENTS.md`).
- **Clerk** auth. **All data goes through the shared `apiRequest` helper (`lib/api.ts`) — never `fetch` the backend yourself.** `apiRequest` calls the API **directly** from the browser (`NEXT_PUBLIC_API_BASE_URL`) with a Clerk token handed over by `ApiAuthBridge` → `lib/api-auth.ts`, and falls back to the server-side proxy `app/api/backend/[...path]/route.ts` (which mints and caches the Clerk JWT) when there is no base URL, no token, a 401, or a direct request that never connected. The direct path skips a billed serverless invocation, a possible cold start and a Clerk round trip per request. POST/PATCH are *not* re-sent through the proxy after a thrown error (could double-create).
- **TanStack Query** for server state; **shadcn/ui** + Tailwind v4 + radix + lucide; **next-themes**.
- **Realtime:** SSE subscription that live-updates the device; reconnect on `visibilitychange` (iOS drops SSE when backgrounded).
- **Persisted query cache:** `PersistQueryClientProvider` (`lib/query-persist.ts`) stores the TanStack cache in localStorage (24h, busted per deploy via `NEXT_PUBLIC_BUILD_SHA`, dropped on sign-out / account change in `ApiAuthBridge`) so a cold launch paints last-known data, then revalidates.
- **PWA:** manifest + service worker; iOS Web Push needs "Add to Home Screen" (16.4+).
- **Naming:** the UI never says "task". A recurring item is a **chore** and a one-time item is a **to-do** (Lists are a separate feature). The code, API (`/tasks`) and DB keep `Task` as the internal name, so don't rename identifiers; just keep user-visible text as chore / to-do.
- **Navigation (companion app):** one list in `components/app-nav-items.ts` feeds both the header menu (`family-menu.tsx`, sm+) and the phone bottom bar (`bottom-nav.tsx`, below sm). Add a page there, not in either component. Chores is one entry: `/chores` (Today/Week) and `/tasks` (Edit) share the `ChoresViewSwitch`.
- File/folder naming: kebab-case; components/types PascalCase; hooks/functions camelCase.

## Deployment — automatic on push to `main` (no manual deploy)
The frontend is hosted on **Netlify** (`MySkylight/netlify.toml`: `next build` + `@netlify/plugin-nextjs`)
and **auto-deploys on every push to `main`** — there's no GitHub Actions workflow and nothing to run by
hand. The **backend deploys separately** (its own GitHub Actions → SSH → rebuild on the Pi, which runs
`alembic upgrade head`). So a push to `main` here goes live on its own.
- When an **API-contract change spans both repos** (e.g. a field added/removed on an endpoint), push the
  backend and frontend close together — otherwise the live FE and BE briefly mismatch.

> **The site was rebuilt on Netlify on 2026-08-25 after a ~$26 function-invocation bill.** Setup +
> verification: **[`docs/NETLIFY-SETUP.md`](./docs/NETLIFY-SETUP.md)**.

### Realtime does NOT go through the proxy — don't "fix" it back
Every route handler is a billed serverless function here, and the platform kills long responses. When
the SSE stream ran through `/api/backend/…` the always-on kiosk reconnected every ~13s, and each
reconnect resynced 14 query keys — on the order of a million invocations a month.

So `hooks/use-realtime.ts` connects **straight to `NEXT_PUBLIC_API_BASE_URL`**, using `fetch` + a
streamed body (not `EventSource`, which can't send an `Authorization` header) with a client-minted
Clerk token, and `lib/sse.ts` does the framing.
- **`NEXT_PUBLIC_API_BASE_URL` must be set in production.** Unset, the stream silently falls back to
  the proxy path and the bill comes back. It's inlined at build time, so changing it needs a redeploy.
- The backend's `CORS_ORIGINS` must list the site's origin, since the browser now calls it cross-origin.
- Regular API calls now go direct too (see Stack above); the proxy is only the fallback, so a missing/wrong `NEXT_PUBLIC_API_BASE_URL` silently puts the bill back for *everything*, not just SSE.

## The wall-display kiosk tablet (read `docs/kiosk/README.md` before touching it)
The `/device` kiosk is a **rooted userdebug Android 12 tablet** (WF3205T) running the site as a
**Kiwi Browser PWA**, pinned full-screen, kept alive by a root watchdog (`docs/kiosk/kiosk.sh`,
started by Termux:Boot). Gotchas that cost hours — don't rediscover them:
- **Fully Kiosk Browser can't work here:** the ROM only allows its built-in WebView **v95**, and the
  Tailwind v4 CSS needs Chrome ≥ ~111 (`@layer`, `color-mix()`), so it renders as unstyled HTML.
  Don't suggest WebView-based kiosk apps for this tablet.
- Root is AOSP-style: use **`su 0 <cmd>`**, not `su -c`. Operate it from the Mac over `adb`
  (wireless debugging; `adb mdns services` finds it) — the user doesn't want to type on the tablet.
- The PWA is a Kiwi *shortcut*, not an app: `docs/kiosk/make-launch-recipe.py` extracts its launch
  recipe; `docs/kiosk/install-to-tablet.sh` installs everything. Unpinning pauses the watchdog 30 min.
- Browsers must keep cookies (Clerk dev-instance handshake), and `/manifest.json` /
  `/device-manifest.json` must be reachable without login (PR #11) for Chrome to offer "Install app".

## Never edit
`.env*` / secrets. `NEXT_PUBLIC_*` are the only client-exposed vars.
