# MySkylight — Performance: findings & plan

> **Status: discovery complete (2026-06-25).** This is a static-analysis pass across
> backend + frontend (6 parallel read-only investigations). **Nothing here has been
> measured yet** — see [§7 Measure first](#7-measure-first-before-you-optimize). Treat the
> rankings as informed hypotheses, not benchmarks.
>
> Context: single household, one Raspberry Pi (`pi.daymonhansen.com`, DDNS) running the
> FastAPI backend behind Caddy; Next.js frontend on **Netlify**; a 24/7 wall kiosk
> (`/device`) + phone companion (`/app`); realtime via SSE. Related:
> [`HomeServerAPI/skylight-api/docs/postgres-migration.md`](../../HomeServerAPI/skylight-api/docs/postgres-migration.md)
> (TL;DR: the DB engine is **not** the bottleneck — don't switch to Postgres for speed).

## 1. The one-paragraph mental model

Latency in this app is dominated by **network round-trips across the public internet**,
not by the database or query speed. Every API call goes browser → Netlify-hosted Next
proxy (`/api/backend/[...path]`, mints a Clerk token) → **cross-internet hop to the home
Pi** → Caddy → FastAPI. That hop is the slowest, least reliable link (the proxy already
carries a 20s timeout + retry because of it). The frontend then *multiplies* that hop by
treating every realtime SSE event as "throw away the cache and refetch," even though the
SSE frame already contains the changed data. On the always-on kiosk, a second, independent
cost is **render churn**: the calendar re-renders its whole tree every minute (a clock
tick) and on every SSE event because nothing is memoized. The backend itself is in good
shape — well-indexed (one gap), well-batched, no N+1 in serialization — with two real
risks: blocking crypto/JWKS work on the event loop, and unbounded recurrence expansion.

**So the highest-leverage work is: (a) stop refetching what SSE already delivered, (b) tame
kiosk re-renders, (c) take blocking work off the backend event loop, (d) close the one
index gap.** None of it requires a database migration.

## 2. Priority shortlist (impact × effort)

Ranked by my synthesis across all six investigations (severity labels in §3–§9 are each
agent's own rating; this ranking weights *realistic impact for this one-household setup*).

| # | Fix | Area | Impact | Effort | Status |
|---|-----|------|--------|--------|--------|
| **1** | Add index on `members.family_id` (+ `user_id`) | Backend DB | High | **XS** (1 migration) | ✅ **shipped** (migration 016) · [§5.1](#51-high--verified-membersfamily_id-is-not-indexed) |
| **2** | SSE updates the cache (`setQueryData` from `msg.data`) instead of invalidate→refetch | FE realtime | High | M | [§4.1](#41-high--sse-carries-the-payload-but-the-client-throws-it-away) |
| **3** | Isolate the per-minute clock + `React.memo` the calendar views | FE render (kiosk) | High | M | [§6.1](#61-high--the-whole-calendar-re-renders-every-minute-247) |
| **4** | Offload JWKS fetch + `jwt.decode` to a thread; tight timeout; warm cache at startup | Backend auth | High | S | [§8.1](#81-high--blocking-jwks--crypto-on-the-event-loop) |
| **5** | Clamp the occurrence date-window server-side | Backend CPU | Med-High | S | ✅ **shipped** (`occurrence_window`, 400-day cap) · [§9.1](#91-high--unbounded-recurrence-expansion-window) |
| **6** | Scope `resync()` to active queries (kill the ~14-query reconnect burst) | FE realtime | Med-High | S | [§4.2](#42-med-high--resync-fans-out-14-refetches-on-every-reconnect) |
| **7** | Replace `BaseHTTPMiddleware` request-ID with pure ASGI middleware | Backend | Med | S | ✅ **shipped** · [§8.2](#82-med--basehttpmiddleware-overhead--sse-risk) |
| **8** | Stop over-fetching the 365-day countdown window on the calendar | FE fetching | Med | S | [§4.4](#44-med--calendar-fetches-a-365-day-window-for-a-countdown-strip) |
| **9** | Scope `member_available` to one member (not the whole family) | Backend DB | Med | S | [§5.2](#52-med-high--single-member-balance-aggregates-the-whole-family) |
| **10** | `next.config` `optimizePackageImports` + dynamic-import the sheets/dialogs | FE bundle | Med | S | ◑ **partial** — `optimizePackageImports` shipped; dynamic imports deferred · [§6.4](#64-med--bundle-no-code-splitting--unoptimized-barrel-imports) |
| **11** | External-sync: skip the commit + back off on empty deltas | Backend sched | Med | S | [§7b](#72-scheduler) / §9 |
| **12** | Batch `aggregate_grocery` into one `IN (...)` query | Backend DB | Low-Med | XS | ✅ **shipped** · [§5.3](#53-med--aggregate_grocery-is-n1-one-query-per-recipe) |

Tail items (lower impact or volume-dependent): drop the Pydantic double-validate on list
endpoints, virtualize `ScheduleView`, precache the SW shell, paginate redemption history,
multi-day weather endpoint, `MAX(sort_order)` in SQL, hoist `me/memberships` to the layout.
All catalogued in §3–§9.

---

## 3. What's already done well (don't redo)

Discovery confirmed a lot of the architecture is sound. Leave these alone:

- **No polling anywhere.** Zero `refetchInterval` / `refetchOnWindowFocus` / `refetchOnMount`
  overrides; freshness is SSE-driven. This avoids the classic refetch-storm anti-pattern.
- **Optimistic mutations done right** (`use-tasks.ts`, `use-lists.ts`): `onMutate` +
  `setQueriesData` with rollback. (This is the exact pattern fix #2 extends to SSE.)
- **Backend eager-loading is thorough** — `_EVENT_LOADS`, `_TASK_LOADS`, routines, lists,
  redemptions, recipes/meals all `selectinload` their relations; the Pydantic `_from_orm`
  validators only walk already-loaded collections → **no lazy-load N+1 in serialization.**
- **Star balances are real SQL** (`func.sum` + `GROUP BY`), 3 queries joined in memory, not
  Python summation; member validation uses `IN (...)`.
- **Auth dep graph is minimal & cached**: FastAPI dependency caching means `get_session`,
  `get_current_user`, `verify_clerk_token` each resolve **once** per request; the family
  route auth is 2 indexed lookups (user, then membership+family in one JOIN). JWKS JSON is
  cached 1h; the RSA key object is reused, not rebuilt per request.
- **SSE bus is bounded & non-blocking**: per-connection `asyncio.Queue(maxsize=100)`,
  `put_nowait` (drops rather than blocks), 25s keepalive, clean unsubscribe; emit happens
  after commit so it never holds a transaction.
- **Scheduler is safe**: `coalesce=True` + `max_instances=1` (no pile-up), skipped under
  tests, delta-aware external sync (Google `syncToken` / CalDAV sync-token), per-account
  failure isolation.
- **Frontend hygiene**: icons tree-shake (no `import * as Icons`), no `moment`/heavy date
  libs (native `Date`), all timers/listeners cleaned up, `next/font` self-hosted fonts,
  solid SSE reconnect on `visibilitychange`/`online`.
- **Indexing is otherwise consistent**: every *other* family-scoped table indexes
  `family_id`; all FK join columns are indexed; `invitations.token` + `memberships(user_id,
  family_id)` unique-indexed. (The lone gap is `members` — finding #1.)

---

## 4. Frontend — realtime & data fetching

### 4.1 HIGH — SSE carries the payload but the client throws it away
`hooks/use-realtime.ts:48-104`. The backend publishes the full changed entity
(`app/services/realtime.py:25`: `{"type", "data"}`), but the client parses only `{type}`
and calls `qc.invalidateQueries(...)` — forcing a **full refetch across the whole
proxy→Pi chain** for data the SSE frame already contained. One person checking a chore
makes every other device do a cross-internet round-trip.
**Fix:** drive `setQueryData` from `msg.data` for the common create/update/complete/toggle
events (the optimistic-update merge logic already exists in the mutation hooks). Keep
`invalidateQueries` only for reconnect catch-up.

### 4.2 MED-HIGH — `resync()` fans out ~14 refetches on every reconnect
`hooks/use-realtime.ts:31-46`. On each reconnect (and iOS backgrounds/foregrounds the
kiosk constantly) it invalidates 14 query keys at once — a thundering herd through the
proxy→Pi hop, even though the current page renders one board.
**Fix:** scope `resync()` to active/mounted queries (`refetchType:'active'`), or add a
`Last-Event-ID` resume cursor so SSE replays missed events instead of brute-forcing all
domains.

### 4.3 MED — Clerk `getToken()` on every proxied request
`app/api/backend/[...path]/route.ts:67-78`. Each request does `auth()` + `getToken()` with
no memoization, adding an auth step in front of every backend hop. Largely mitigated by
cutting request *count* (4.1/4.2); a short-lived server token cache is a secondary option.

### 4.4 MED — Calendar fetches a 365-day window for a countdown strip
`components/calendar/calendar-view.tsx:183-214`. Two `useOccurrences` calls: the visible
range **and** a today→+365-day window for the countdown strip — a year of occurrences for
a small widget, refetched together on any `event.*` SSE event.
**Fix:** a lightweight backend countdowns endpoint, or derive countdowns from a smaller
forward window; long `staleTime` on the wide query.

### 4.5 LOW — assorted
Chore board issues two task-occurrence queries (main + overdue) that could be one range
(`chore-board.tsx:128-129`); weather uses per-day `useQueries` → up to 7 parallel calls in
week view (`use-weather.ts:47-70`, mitigated by 1h `staleTime`); `lib/use-api-query.ts` is
a legacy non-TanStack fetcher to consolidate or delete.

---

## 5. Backend — database queries & indexes

### 5.1 HIGH — ✅ verified: `members.family_id` is NOT indexed
`app/models/family.py:69` declares `family_id` with **no** `index=True` (and `user_id:70`
likewise); `docs/schema.sql` confirms the `members` table has zero secondary indexes (and
SQLite does not auto-index FKs). `Member.family_id` is filtered on nearly every hot read —
`rewards.compute_balances`, `tasks.get_task_occurrences`, every member/assignee validation,
`members.list_members`, `ensure_member_for_user` — so each is a **full table scan**.
(This corrects an earlier claim that "family_id is indexed everywhere" — it's everywhere
*except* `members`.)
**Fix:** add `index=True` to `Member.family_id` and `Member.user_id`; one migration.

### 5.2 MED-HIGH — single-member balance aggregates the whole family
`app/services/rewards.py:126-131` → `_earned_map`/`_redemption_maps` (`:68-101`). To check
one member's balance on redeem, it runs the **family-wide** `SUM ... GROUP BY member` and
throws away every member but one. `task_completions` grows unbounded over time.
**Fix:** add a `member_id` filter (or a dedicated single-member query).

### 5.3 MED — `aggregate_grocery` is N+1 (one query per recipe)
`app/services/meals.py:357-360`: `for rid in recipe_ids: await get_recipe(rid)`.
**Fix:** one `WHERE Recipe.id IN (:ids)` + `selectinload(ingredients)`, reorder in Python.

### 5.4 MED — no pagination on history lists
`rewards.list_redemptions` (and other list endpoints) have no `LIMIT`; redemption history
is naturally unbounded. Low urgency today; paginate `list_redemptions` first as counts grow.

### 5.5 LOW — `_next_item_sort_order` fetches all rows to `max()` in Python
`app/services/lists.py:123-130` → use `SELECT MAX(sort_order)`.

---

## 6. Frontend — rendering (kiosk uptime weighted highest)

### 6.1 HIGH — the whole calendar re-renders every minute, 24/7
`components/calendar/week-view.tsx:77-81`, `day-view.tsx:76-80`:
`setInterval(() => setNow(...), 60_000)` lives inside the big view, so every minute the
entire grid re-builds `byDay`, re-filters events, and re-renders all columns — to move a
1px "now" line. Forever, on a low-power display.
**Fix:** extract a tiny `<NowIndicator>` that owns its own interval/state so only the line
re-renders each minute.

### 6.2 HIGH — calendar views aren't memoized
Zero `React.memo` in the codebase. `MonthView`/`WeekView`/`DayView`/`ScheduleView`/
`EventDot`/`CountdownStrip`/`MemberFilter` recompute layout (`packDayEvents()` O(n log n),
`byDay` Maps) on every parent render — every minute (6.1), every SSE event (6.3), every
filter/weather/resize. Inline arrow `onClick`s defeat child memoization.
**Fix:** `React.memo` the views + leaf components; `useCallback` the handlers passed down.
With 6.1, the minute tick then re-renders only the now-line.

### 6.3 HIGH — any SSE event invalidates the whole occurrences cache → full refetch + re-render
`hooks/use-realtime.ts:54-60`: `event.*`/`calendar.*` invalidates **every** occurrences
query (visible range + the 365-day countdown window, 4.4), then re-renders the unmemoized
grid. **Fix:** primarily 4.1 (setQueryData) + 6.2 (memo) so a change ≠ full-screen refetch.

### 6.4 MED — bundle: no code-splitting & unoptimized barrel imports
`next.config.ts` sets no `experimental.optimizePackageImports`; the `radix-ui` meta-package
is imported app-wide. Zero `next/dynamic`/`import()` — heavy modal components (`task-sheet`
724 lines, `event-sheet` 556, recipe/grocery/settings dialogs) ship in the route bundle.
**Fix:** `optimizePackageImports: ["radix-ui","lucide-react"]`; `next/dynamic` the
sheets/dialogs so they load on first open.

### 6.5 MED — service worker never precaches the shell
`public/sw.js` is network-first with no install-time precache, so a power-blip reboot while
the backend is briefly unreachable → blank kiosk. Static-chunk cache also grows unbounded
across deploys. **Fix:** precache the device shell on `install`; add age/version pruning.

### 6.6 MED/LOW — board derived-data not memoized; `ScheduleView` unvirtualized
`chore-board.tsx`/`meal-board.tsx` recompute Maps/arrays per render on every SSE tick
(memoize them); `schedule-view.tsx:80-137` renders up to 90 days of event cards with no
virtualization (memoize grouping; virtualize if the list gets long).

---

## 7. Backend — per-request overhead (auth / middleware)

### 8.1 HIGH — blocking JWKS + crypto on the event loop
`app/core/security.py:24-30`. `verify_clerk_token` is `async` but never offloads:
- The JWKS fetch (cold start + hourly cache expiry + unknown-`kid`) uses PyJWT's
  **synchronous `urllib.urlopen`** with a 30s default timeout, **on the event loop** — a
  slow Clerk response stalls *every* concurrent request on the single-process Pi.
- RS256 signature verify (`jwt.decode`) runs inline on the loop on every authed request —
  CPU on the loop caps throughput on a few-core Pi.

**Fix:** wrap `get_signing_key_from_jwt` + `jwt.decode` in `asyncio.to_thread(...)`; set a
short `PyJWKClient(timeout=3-5)`; warm the JWKS cache in the lifespan startup so the first
real request never pays for the fetch.
*(The CLAUDE.md "networkless JWKS" claim is true in steady state — cached 1h — but not on
cold start / expiry; this fix makes those non-blocking.)*

### 8.2 MED — `BaseHTTPMiddleware` overhead + SSE risk
`app/core/logging.py:23` (`RequestIDMiddleware`), installed `app/main.py:63`. Starlette's
`BaseHTTPMiddleware` wraps each request in a task group + memory streams (measurable
overhead) and is notorious for buffering/breaking streaming responses — and this app has an
SSE endpoint. **Fix:** rewrite as a pure ASGI middleware (`async def __call__(scope,
receive, send)`). SSE-safe and cheaper.

### 8.3 LOW — auth is 2 round-trips (already near-minimal)
`app/deps.py:56-83`: user lookup, then membership+family JOIN. Both indexed single lookups;
collapsing to one query is possible but `get_current_user` is reused by non-family routes,
so the split is reasonable. Leave unless profiling says otherwise.

---

## 8. Backend — realtime, scheduler, serialization

### 9b. Scheduler
- **MED — external-sync does network I/O + a token-write commit every 5 min per account
  even on an empty delta** (`scheduler.py:33-62`, `external_sync.py:226,329`). Sequential
  over accounts; always commits `last_synced_at`. **Fix:** skip the commit when
  `totals.total == 0` and token unchanged; back off the interval after empty ticks;
  `asyncio.gather` across accounts if the count grows.
- **MED — sync runs on the request event loop**; genuinely async, but a hung provider holds
  a coroutine up to its timeout (CalDAV read timeout **60s**, `caldav.py:106`). Trim the
  timeout; move to a worker process only if accounts grow.
- **LOW — weather refresh** re-fetches every cached row serially every 30 min ignoring the
  1h TTL (`weather.py:75-102`); dedupe by location, skip fresh rows.

### 9c. Serialization
- **MED — double work on list endpoints**: `_from_orm` (`mode="before"`) hand-builds a dict,
  then `model_validate` re-validates it, then FastAPI serializes again — ~3 passes per item
  (`events.py:41`, `tasks.py:111`, `lists.py:51`). Milliseconds at household scale, but the
  clearest avoidable cost. **Fix:** `ConfigDict(from_attributes=True)` + computed fields, or
  return plain dicts and let FastAPI serialize once.

## 9. Backend — recurrence expansion (CPU)

### 9.1 HIGH — unbounded recurrence-expansion window
`app/routers/events.py:25-31` + `app/services/calendar.py:391-421`; same for tasks
(`routers/tasks.py:97-101`, `services/tasks.py:501-582`). The `from`/`to` params have **no
max-window validation**, so a request like `from=2000&to=2100` materializes tens of
thousands of `OccurrenceOut` objects per recurring series. Client-controlled CPU blowup.
**Fix:** clamp `to - from` server-side (reject/truncate beyond ~366–400 days) before
expansion.

### 9.2 MED — rotating tasks expand from `start_date`, not `from_date`
`services/tasks.py:524` (and `compute_streak` `:455`): rotating tasks expand the **entire**
series from `start_date` to compute rotation-bucket indices, discarding everything before
`from_date`. Cost scales with series age, not window. **Fix:** for time-based rotation
units, compute the bucket arithmetically from the anchor (`_rotation_bucket` is already O(1)
there); only `RotationUnit.occurrence` truly needs the running index.

*(Note: recurrence expansion does **zero DB queries** — assignments/overrides/completions
are resolved from pre-loaded in-memory dicts. The cost is pure CPU, bounded by the window.)*

---

## 7. Measure first (before you optimize)

This was static analysis with **no runtime numbers**. Before investing in the medium/large
items, confirm where time actually goes:

1. **The cross-internet hop (suspected #1 latency source).** Add timing to the Next proxy
   (`route.ts`) logging upstream duration; compare against backend-local request time. If
   the hop dominates (likely), fixes #2/#6/#8 (fewer requests) matter most.
2. **Backend per-endpoint timing.** Add a `Server-Timing` header or structured per-request
   duration log (the request-ID middleware is the natural place — once it's pure ASGI). Watch
   `get_occurrences`/`get_task_occurrences` specifically.
3. **Kiosk render cost.** React DevTools Profiler on `/device` for 2–3 minutes — confirm the
   minute-tick full-tree re-render (#3) before/after.
4. **JWKS stall.** Log when the JWKS network fetch fires and its duration to confirm #4's
   cold-start/hourly blocking.

A handful of quick wins are safe to do **without** measuring because they're pure upside and
near-zero risk: **#1 (members index), #5/9.1 (clamp the window), #7 (ASGI middleware),
#10 (`optimizePackageImports`), #12 (batch grocery).**

## 8. Suggested sequencing

- **Phase 1 — quick wins (≈ half day): ✅ SHIPPED 2026-06-25.** #1 (migration 016, `members`
  indexes), #5/9.1 (`app/core/validation.py::occurrence_window`, 400-day cap, +2 tests), #7
  (pure-ASGI `RequestIDMiddleware`), #12 (batched `aggregate_grocery`), and the
  `optimizePackageImports` half of #10. All 141 backend tests pass. *Deferred from #10:*
  `next/dynamic` code-splitting of the sheets/dialogs (larger change → Phase 4).
- **Phase 2 — the realtime refactor (≈ 1–2 days):** #2 (SSE `setQueryData`) + #6 (scoped
  resync) + #3 (clock isolation + `React.memo`). This is the biggest perceived-speed win for
  the kiosk; do the three together since they interact.
- **Phase 3 — backend hardening (≈ 1 day):** #4 (JWKS/crypto off the loop + warm cache),
  #9 (single-member balance), #11 (idle external-sync), serialization double-validate.
- **Phase 4 — as data grows:** pagination, `ScheduleView` virtualization, SW precache,
  multi-day weather endpoint, code-split sheets.

Re-measure (§7) after Phase 1–2 before committing to Phase 3–4.

---

*Living document. Update as items ship; tick corresponding work in
[TRACKER.md](./TRACKER.md). Findings sourced from a 2026-06-25 parallel discovery pass;
the `members` index gap was directly verified, the rest are file:line-grounded static
analysis pending measurement.*
