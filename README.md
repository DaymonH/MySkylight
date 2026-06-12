# MySkylight

A self-hosted clone of the **Skylight Family Calendar** — a wall-mounted touchscreen "hub of the
home" plus a companion mobile app, on our own backend.

- **Frontend** — `MySkylight/` · Next.js 16 + React 19 + Tailwind v4 + shadcn/ui. One app serving a
  full-screen **device/kiosk** view (`/device`) and a mobile **companion** PWA (`/app`).
- **Backend** — `MySkylightBackend/` · **FastAPI + SQLite** (SQLAlchemy + Alembic), **Clerk** auth
  (JWT verification + webhooks), per-family authz, realtime SSE, APScheduler, DeepSeek for AI features.

## Key decisions
1. **One responsive Next.js app + PWA** for both screen and phone (no separate native app yet).
2. **Internal calendar first**; external sync (Google/Outlook/Apple/Cozi/Yahoo) is a later phase.
3. **DeepSeek** powers the AI "Smart" features (Magic Import, recipe generation).
4. **Clerk** for authentication (identity only) — Family, roles, and invitations stay in our DB.

## 📚 Documentation
| Doc | What's in it |
|-----|--------------|
| [docs/PLAN.md](./docs/PLAN.md) | Vision, tech stack, architecture, data model, API surface, **phased roadmap**, risks |
| [docs/FEATURES.md](./docs/FEATURES.md) | Every Skylight feature → our spec, BE/FE pieces, acceptance criteria (`Fxx` IDs) |
| [docs/TRACKER.md](./docs/TRACKER.md) | **Living checklist** — 148 tasks across 10 phases; tick items as you build |

## Feature coverage at a glance
**Free:** Tasks/Chores · Color Coding · Mobile App · Custom Lists · Grocery→Instacart · Day/Week/Month/Schedule
views · Weather · Event Countdowns · Sleep Mode · Parental Lock · Software Updates · Device Linking · Share Access
**Calendar Plus:** Rewards · Meal Planning · Photo Screensaver · Magic Import (AI)
**Auto-sync (later):** Google · Outlook · Apple · Cozi · Yahoo

## Status
🟡 **Planning complete — implementation not started.** Next up is **Phase 0 (Foundations)** in
[docs/TRACKER.md](./docs/TRACKER.md): git init, FastAPI skeleton + SQLite/Alembic, Next.js `/device`
& `/app` shells, API client, **Clerk wiring (both ends)**, realtime + PWA scaffolding.

## Repo layout
```
SkylightClone/
├── README.md              ← you are here
├── docs/                  ← plan, feature specs, tracker
├── MySkylight/            ← Next.js frontend (device + mobile PWA)
└── MySkylightBackend/     ← FastAPI + SQLite backend (to be scaffolded)
```
