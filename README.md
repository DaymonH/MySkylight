# MySkylight

A self-hosted replacement for the **Skylight Family Calendar**: a wall-mounted touchscreen "hub of
the home" plus a companion mobile app, running on my own backend instead of a subscription.

Both surfaces — the kiosk and the phone — are served by one Next.js app against one FastAPI service.

**Status: working software, actively built.** 154 of 195 tracked tasks complete. Phases 0–4
(foundations, identity, calendar, tasks, lists) are done end to end; phases 5–7 are partial; 8–9
haven't started. Details in [docs/TRACKER.md](./docs/TRACKER.md).

## Verify it in under a minute

```bash
# Backend lives in the HomeServerAPI repo (skylight-api/)
git clone https://github.com/DaymonH/HomeServerAPI && cd HomeServerAPI/skylight-api
uv run --extra dev pytest -q
```

That suite is not decorative. It includes `test_authz.py` and `test_calendar_authz.py` (can a member
of family A read family B's data — no), `test_security.py`, and `test_webhooks.py` (Clerk signature
verification, including forged and replayed payloads). Multi-tenant authorization is the part of this
app that would actually hurt if it were wrong, so it's the part with the most tests.

```bash
# What the API surface looks like
cat HomeServerAPI/skylight-api/docs/api.md
# The data model, generated from the live schema
cat HomeServerAPI/skylight-api/docs/schema.sql
```

## Architecture

**One backend, two very different front ends.** The device is a wall-mounted always-on touchscreen
used by the whole family, including kids with PINs; the phone is a private, authenticated companion.
Same data, same realtime stream, different assumptions about who's holding it.

| | |
|---|---|
| **Frontend** — `MySkylight/` | Next.js 16, React 19, Tailwind v4, shadcn/ui. 19 routes across a full-screen kiosk view (`/device`) and a mobile PWA (`/app`), plus invite acceptance and auth flows. 95 components/pages. |
| **Backend** — [`HomeServerAPI/skylight-api`](https://github.com/DaymonH/HomeServerAPI/tree/main/skylight-api) | FastAPI + SQLAlchemy (async) + SQLite, 24 Alembic migrations, 15 routers, 16 service modules. Clerk for identity only — families, roles, and invitations live in this database. Realtime via SSE; background refresh via APScheduler. |

**Layering:** `routers/` handle HTTP and nothing else, `services/` hold the domain logic
(calendar recurrence, chore balancing, CalDAV sync, rewards, weather), `models/` and `schemas/` keep
the ORM and the wire format separate. `app/ai/provider.py` isolates the AI vendor behind one
interface — the project moved from DeepSeek to Gemini Flash-Lite without touching any caller.

## Running it

```bash
# Backend (separate repo: DaymonH/HomeServerAPI)
cd HomeServerAPI/skylight-api
cp .env.example .env          # fill in Clerk keys; GEMINI_API_KEY optional
uv run alembic upgrade head
uv run uvicorn app.main:app --reload

# Frontend
cd MySkylight
npm install && npm run dev    # /device for the kiosk, /app for the phone
```

Production runs in Docker behind Caddy on a Raspberry Pi. Without `GEMINI_API_KEY` set, the AI
endpoints return 503 and everything else works normally — the AI features are additive, not load-bearing.

## Notes on a few decisions

- **Clerk for identity, our DB for authority.** Clerk answers "who is this human." It does not decide
  what they can see. Family membership, roles, and per-family access are ours, which is why the authz
  tests are ours too.
- **The AI is behind an interface and allowed to be absent.** Magic Import (paste a school newsletter,
  get structured events) is a genuine language problem and worth a model. Everything else — recurrence,
  chore rotation, streaks — is deterministic, because a family calendar that occasionally invents an
  appointment is worse than no calendar.
- **Scope was cut on purpose, and written down.** Instacart checkout (F05) descoped, photo screensaver
  (F16) parked, external-calendar *writes* (F19/F21/F22) descoped in favor of read-only sync. Each is
  recorded in the tracker with the reason rather than left as a silent gap.
- **SQLite, deliberately.** One family, one Pi. [docs/postgres-migration.md](https://github.com/DaymonH/HomeServerAPI/tree/main/skylight-api/docs/postgres-migration.md)
  covers the move if that stops being true.

## Not done yet

Phase 8 (device pairing, sleep mode, software updates) and Phase 9 (polish and hardening) are
untouched. The Smart/AI phase has a working backend but the review UIs are unfinished. There's no CI —
tests are run locally. External calendar sync is read-only.

## Documentation

| Doc | What's in it |
|---|---|
| [docs/PLAN.md](./docs/PLAN.md) | Vision, architecture, data model, API surface, phased roadmap, risks |
| [docs/FEATURES.md](./docs/FEATURES.md) | Every feature spec'd with acceptance criteria (`Fxx` IDs) |
| [docs/TRACKER.md](./docs/TRACKER.md) | Living checklist — 195 tasks across 10 phases, with what was cut and why |
| [skylight-api/docs/api.md](https://github.com/DaymonH/HomeServerAPI/tree/main/skylight-api/docs/api.md) | Generated API reference |

## Layout

```
MySkylight/
├── MySkylight/            ← Next.js frontend (kiosk + mobile PWA)
└── docs/                  ← plan, feature specs, tracker

Backend: github.com/DaymonH/HomeServerAPI → skylight-api/
```
