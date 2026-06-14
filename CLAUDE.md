# CLAUDE.md — MySkylight Frontend (`SkylightClone`)

Next.js 16 PWA frontend for **MySkylight**, a self-hosted Skylight Family Calendar clone. One PWA
codebase serves two surfaces: **`/device`** (wall-mounted kiosk) and **`/app`** (phone/tablet companion).
The app lives in **`MySkylight/`**; the FastAPI backend is a separate repo (see below).

## ⚠️ Read the canonical docs first
- **`docs/PLAN.md`** — architecture, stack, phased roadmap, decisions
- **`docs/FEATURES.md`** — per-feature specs with stable `Fxx` IDs + acceptance criteria
- **`docs/TRACKER.md`** — phase-by-phase checklist; **Appendix A** = FE granular checklist, **Appendix B** = FE conventions + the *actual* route tree

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

## Never edit
`.env*` / secrets. `NEXT_PUBLIC_*` are the only client-exposed vars.
