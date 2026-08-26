# Netlify setup — bringing the site back, without the invocation bill

The Netlify site was deleted after a ~$26 month of **function invocations**. The cause wasn't
traffic; it was the realtime stream. This is how to stand the site back up so that doesn't recur.

## What was actually costing money

`hooks/use-realtime.ts` opened its SSE stream at `/api/backend/api/v1/families/<id>/stream` — a route
handler, which on Netlify is a **serverless function**. Functions have a short execution ceiling, so
the platform killed the stream seconds after it opened. The hook then reconnected 3s later, and every
reconnect ran `resync()` across 14 query keys.

For a wall display that never sleeps:

| | |
|---|---|
| Reconnect cycle | ~10s of stream + 3s backoff ≈ **13s** |
| Reconnects/day | **~6,600** |
| × SSE + mounted refetches | **tens of thousands of invocations/day** |
| Netlify free tier | **~125,000/month** |

The kiosk alone could clear a month's allowance in about a day — before anyone opened the app on a
phone. Page views were never the problem.

## The fix

The browser now holds the SSE connection **directly against `skylight-api.daymonhansen.com`**, so
Netlify never sees it. One connection lasts hours instead of dying every few seconds, which removes
the reconnect storm and the refetch storm with it. Netlify is left serving page loads and mutations —
comfortably inside the free tier.

`EventSource` can't send an `Authorization` header and the backend accepts bearer tokens only there,
so the stream is read with `fetch` + a streamed body and the token is minted client-side. No backend
code changed; only a CORS value.

---

## 1. Backend: allow the site's origin — ✅ DONE 2026-07-30

Applied on the Pi (`pi@192.168.68.59`, repo at `~/HomeServerAPI`) and verified. Nothing to do here
unless it gets reverted. What changed in `skylight-api/.env` (backup left at `.env.bak-20260730`):

```env
CORS_ORIGINS=https://myskylight.daymonhansen.com,http://localhost:3000
FRONTEND_URL=https://myskylight.daymonhansen.com
```

`CORS_ORIGINS` previously allowed only `http://localhost:3000`, which would have blocked the direct
stream. `FRONTEND_URL` was **not set at all**, so it was falling back to the code default of
`http://localhost:3000` — that's where the Google Calendar OAuth callback returns the browser, so a
connect attempt would have dead-ended on localhost. (Google OAuth isn't configured on this instance
yet — no `GOOGLE_CLIENT_ID` — so it was latent rather than broken, but it's right now.)

Verified against the live API after `docker compose up -d skylight-api`:

| Check | Result |
|---|---|
| `Origin: https://myskylight.daymonhansen.com` on `/api/v1/health` | `access-control-allow-origin` echoed back ✅ |
| Preflight `OPTIONS` on the stream endpoint with `Access-Control-Request-Headers: authorization` | `200`, `access-control-allow-headers: authorization` ✅ |
| `Origin: http://localhost:3000` | still allowed — local dev unaffected ✅ |
| `GET` stream with no token | `401` — endpoint live and still gated ✅ |

That preflight is the one that matters: a cross-origin `fetch` carrying an `Authorization` header
triggers an `OPTIONS` first, and the stream never opens if it fails.

To re-check at any time:

```bash
curl -s -i -H "Origin: https://myskylight.daymonhansen.com" \
  https://skylight-api.daymonhansen.com/api/v1/health | grep -i access-control-allow-origin
```

**No output means it's blocked** and the stream will fail in the browser with a CORS error.

## 2. Re-create the Netlify site

- [ ] New site → import from Git → the `MySkylight` repo, branch `main`
- [ ] **Base directory: `MySkylight`** (the app is in a subdirectory; this is easy to miss)
- [ ] Build command `next build`, publish directory `.next` — `netlify.toml` already declares these
      plus `@netlify/plugin-nextjs`, so the defaults should be picked up

## 3. Environment variables

Site settings → Environment variables. The old values died with the old site, so these come fresh
from the Clerk dashboard → API Keys.

> **Use the `trusted-beetle-9` development instance — the `pk_test_…` / `sk_test_…` keys.** Checked on
> the Pi 2026-07-30: the production backend validates against
> `https://trusted-beetle-9.clerk.accounts.dev/.well-known/jwks.json` and holds an `sk_test` secret, so
> that's the only instance whose tokens it will accept. Production (`pk_live_…`) keys would let people
> sign in and then 401 on every single API call, which looks like a backend outage rather than a key
> mismatch. Switching to a production instance later means changing the frontend keys **and** the
> backend's `CLERK_JWKS_URL` + `CLERK_SECRET_KEY` together, in one go.

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_test_…` (trusted-beetle-9) |
| `CLERK_SECRET_KEY` | `sk_test_…` (trusted-beetle-9) |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` | `/` |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` | `/` |
| `CLERK_JWT_TEMPLATE` | `skylight-api` |
| `NEXT_PUBLIC_CLERK_JWT_TEMPLATE` | `skylight-api` |
| `API_BASE_URL` | `https://skylight-api.daymonhansen.com` — server-side proxy target |
| **`NEXT_PUBLIC_API_BASE_URL`** | **`https://skylight-api.daymonhansen.com`** — the whole point of this change |

> **`NEXT_PUBLIC_API_BASE_URL` is the one that must not be forgotten.** Omit it and nothing appears
> broken — the app works, the stream just silently reverts to the proxy route and starts burning
> invocations again. `NEXT_PUBLIC_*` values are compiled into the bundle, so adding it later needs a
> **redeploy**, not a restart.

## 4. DNS

`myskylight.daymonhansen.com` currently resolves to **nothing** (checked 2026-07-30) — the old record
went with the old site.

- [ ] Add Netlify's custom domain, then at Namecheap create the record Netlify asks for (normally a
      `CNAME` to `<site>.netlify.app`)
- [ ] Wait for the Netlify-managed certificate to issue
- [ ] `dig +short myskylight.daymonhansen.com` returns something

## 5. Clerk

- [ ] Webhook endpoint → `https://myskylight.daymonhansen.com/api/webhooks/clerk`, and its signing
      secret must match `CLERK_WEBHOOK_SECRET` in the Pi's `skylight-api/.env`
- **No domain configuration needed.** It's a development instance, and those accept any origin — so
  there are no `clerk.` / `accounts.` / `clkmail.` DNS records to create and nothing to verify. The
  only DNS record this project needs is the site's own (§4).
- Worth knowing rather than acting on: a dev instance shows Clerk's "development mode" banner and
  carries lower limits (user caps, shorter-lived sessions). It's what's been running in production all
  along; moving to a production instance is a deliberate change to make on both sides at once, not
  part of this rebuild.
- [x] `FRONTEND_URL` in the Pi's `skylight-api/.env` — set 2026-07-30 (see §1)

## 6. Verify — especially the part that costs money

- [ ] Site loads, sign-in works
- [ ] A family page loads data
- [ ] **The stream is direct and stays open.** In the browser devtools → Network, filter to `stream`.
      You want **one** request to `skylight-api.daymonhansen.com` sitting in `pending` indefinitely.
      If instead you see repeated requests to `/api/backend/...` every few seconds, `NEXT_PUBLIC_API_BASE_URL`
      didn't make it into the build — fix it and redeploy
- [ ] Change something on a phone and watch the device update — proves events still arrive
- [ ] Leave the kiosk running, then check **Netlify → Usage** the next day. Function invocations
      should now be a few hundred a day, not tens of thousands

## If it regresses

The stream falling back to the proxy is the failure mode to watch for, and it's invisible from the
outside. Netlify's usage graph is the canary: a flat, high, round-the-clock invocation rate means the
kiosk is reconnecting again. Check `NEXT_PUBLIC_API_BASE_URL` first, then CORS.

## The road not taken

Self-hosting the frontend next to the API removes the platform from the equation entirely — no
invocation limits, and the SSE code needs no special handling because a Node server holds connections
open indefinitely. That work is written and verified but **parked**: MySkylight PR #2 and
HomeServerAPI PR #5, with a full cutover runbook in that branch's `docs/MIGRATION.md`. Worth revisiting
if Netlify's limits become a problem again, or if you'd rather not depend on their pricing.

One finding from that work is worth keeping in view regardless: the desktop that would host it runs
ProtonVPN with a **permanent kill switch**, which owns the default route. Any future attempt to serve
public traffic from that machine has to deal with that first — see `docs/MIGRATION.md` §1a.
