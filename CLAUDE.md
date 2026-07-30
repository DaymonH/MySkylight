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
- **Clerk** auth via a server-side proxy: `app/api/backend/[...path]/route.ts` injects the Clerk JWT — never call the backend or `getToken()` directly; route data through the proxy / a shared `apiRequest` helper.
- **TanStack Query** for server state; **shadcn/ui** + Tailwind v4 + radix + lucide; **next-themes**.
- **Realtime:** SSE subscription that live-updates the device; reconnect on `visibilitychange` (iOS drops SSE when backgrounded).
- **PWA:** manifest + service worker; iOS Web Push needs "Add to Home Screen" (16.4+).
- File/folder naming: kebab-case; components/types PascalCase; hooks/functions camelCase.

## Deployment — automatic on push to `main` (no manual deploy)
**Self-hosted** on the home Ubuntu server (the Jellyfin box) as the `myskylight-web` Docker service,
behind the same Caddy that fronts the APIs. Live at `https://myskylight.daymonhansen.com`.
Was on Netlify until 2026-07-29; moved because Netlify bills per function invocation and a Next.js
app invokes one on nearly every request (Clerk middleware + the API proxy route).

`.github/workflows/deploy.yml` **auto-deploys on every push to `main`** that touches `MySkylight/**`
— it SSHes to the server and runs `ops/deploy.sh myskylight` from the **HomeServerAPI** repo, which
owns `docker-compose.yml`, the `Caddyfile`, and the deploy script. That target pulls this repo,
rebuilds the image, health-checks `/api/health` inside the container, and rolls back on failure. The
**backend deploys separately** from its own repo (SSH → rebuild → `alembic upgrade head`).
- When an **API-contract change spans both repos** (e.g. a field added/removed on an endpoint), push the
  backend and frontend close together — otherwise the live FE and BE briefly mismatch.
- **Config lives on the server**, in `HomeServerAPI/.env` — not here, and no longer in a hosting
  dashboard. `NEXT_PUBLIC_*` values are compiled into the client bundle, so changing one needs a
  **rebuild**, not a restart: push, or run the workflow manually via `workflow_dispatch`.
- **Where things run:** `Dockerfile` (multi-stage, `output: "standalone"`) builds it;
  `app/api/health/route.ts` is the deploy's liveness probe; `app/sw.js/route.ts` reads `COMMIT_REF`,
  which the deploy script sets from this repo's git SHA to bust the kiosk's service-worker cache.
- The proxy route reaches the backend at `http://skylight-api:8001` over the Docker network, so API
  traffic never leaves the host — don't point `API_BASE_URL` at the public API domain in production.

## Never edit
`.env*` / secrets. `NEXT_PUBLIC_*` are the only client-exposed vars.
