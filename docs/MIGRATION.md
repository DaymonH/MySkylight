# Migration runbook — Netlify → home server

**Goal:** MySkylight's frontend stops running on Netlify (which billed ~$26/month for function
invocations) and runs on the home Ubuntu desktop instead, alongside the APIs. The Raspberry Pi 3B+ is
retired as a host and everything consolidates onto one machine.

**This is one migration, not two.** Everything moves in a single cutover: the frontend arrives from
Netlify, and `skylight-api`, `workout-api`, `landlord-api`, Caddy and the DDNS updater all move off
the Pi. There's no separate backend step — the APIs rebuild from source on the desktop, so the only
thing that physically moves is their data and secrets (§5).

**Why one machine:** a router can forward ports 80/443 to exactly **one** host. The APIs' Caddy
already owns that forward, so the frontend has to live behind the same Caddy.

**Why not the Pi:** 1 GB of RAM can't run `next build`, Next.js 16 ships no 32-bit ARM compiler
binary, and the Pi had chronic under-voltage hangs.

### The two PRs that implement this

| Repo | Branch | PR | Contains |
|---|---|---|---|
| HomeServerAPI | `feat/self-host-frontend` | [#5](https://github.com/DaymonH/HomeServerAPI/pull/5) | `myskylight-web` Compose service, Caddy block, `ops/deploy.sh myskylight`, `ops/preflight.sh`, `ops/migrate-from-pi.sh` |
| MySkylight | `feat/self-host` | [#2](https://github.com/DaymonH/MySkylight/pull/2) | `Dockerfile`, `output: "standalone"`, `app/api/health`, deploy workflow, Netlify config deleted |

Neither works without the other. Both are drafts — **§7 covers when to merge them.**

**Time:** ~2–3 hours, most of it waiting. Downtime starts at §5 and ends at §7.

> Terminology: **"desktop"** = the new Ubuntu/Jellyfin host. **"Pi"** = the old host.
> Commands run on the desktop unless labelled otherwise.

---

## 0. Gather access before you start

- [ ] **Clerk dashboard** — you'll need the production API keys (they lived in Netlify's env vars and were deleted with the site)
- [ ] **Namecheap** — DNS records for `daymonhansen.com` + the Dynamic DNS password
- [ ] **Router admin** — to change port forwarding and set a DHCP reservation
- [ ] **Pi SSH** — `ssh pi@pi.daymonhansen.com -p 2222`, or `ssh pi@192.168.68.62` on the LAN
- [ ] **Desktop** — `ssh king@192.168.68.61` (key auth already set up from the Mac). You also need the
      `sudo` **password** — `king` has no passwordless sudo, so the Docker install can't be scripted
      remotely
- [ ] **ProtonVPN app** on the desktop — see the blocker in §1a
- [ ] **GitHub** — repo settings → secrets, for both repos

---

## 1. Host facts — verified, plus the one blocker

Surveyed over SSH on **2026-07-30**. The facts below are measured, not assumed; re-check only if the
machine changes.

| | |
|---|---|
| Host | `king-desktop`, `king@192.168.68.61` (SSH key auth from the Mac already works, port 22) |
| OS | Ubuntu 22.04.5 LTS, kernel 6.8, **x86-64** |
| Resources | 7.7 GB RAM, 4 cores, 407 GB free on `/` — comfortably enough for `next build` (~2 GB) |
| **Ports 80/443** | **free** — nothing listening. Caddy can take them |
| Jellyfin | bare-metal systemd service, active + enabled at boot, on `:8096` — **no conflict** |
| Docker | **not installed** (§2a). `king` has **no passwordless sudo**, so you must run that step yourself |
| Auto-suspend | already effectively off (`sleep-inactive-ac-type=nothing`, logind `IdleAction` default) — §2c is verify-only |
| `git` | 2.34.1, present |
| Repos | `~/GithubProjects` doesn't exist yet (§2e creates it) |
| Home public IP | `204.8.100.99` — and `skylight-api`/`landlord-api`/`workout-api`/`pi` all resolve to it, so the Pi's DDNS is working |
| `myskylight.daymonhansen.com` | **no DNS record at all** — the Netlify record is already gone, so §3a only has to *create* one |
| Pi | still live and serving (`skylight-api` health → 200) |

### 🛑 1a. BLOCKER — ProtonVPN's kill switch owns the default route

**This must be resolved before anything else in this runbook will work.** The desktop runs ProtonVPN
(WireGuard) with `"killswitch": 2` — the *permanent* kill switch — in `~/.config/Proton/VPN/settings.json`.
It installs a default route via Proton's kill-switch interface (`pvpnksintrf1`, metric 98) that wins
over the LAN gateway (metric 100). Measured consequences:

| Symptom | Evidence |
|---|---|
| The box's public IP isn't yours | `curl api.ipify.org` on the desktop → `159.26.102.97` (Proton exit), vs `204.8.100.99` from the LAN |
| Replies to visitors leave via the tunnel | `ip route get 1.2.3.4 from 192.168.68.61` → `dev proton0` |

So: **DDNS would publish Proton's IP**, repointing not just the new site but the three APIs that work
today; and inbound port-forwarded connections would be answered out the wrong interface, so
Let's Encrypt could never validate and no certificate would ever issue. `killswitch: 2` survives
reboots and stays in force even when the app shows "disconnected" — disconnecting is *not* enough.

- [ ] **Fix — split tunnelling in "include" mode** (chosen 2026-07-30; the Proton split-tunnel daemon
      is already running on this box, so it's supported). In the Proton VPN app:
  1. **Settings → Kill switch → Off.** Permanent kill switch and a public server can't coexist; it's
     the kill switch, not the tunnel, that hijacks routing.
  2. **Settings → Split tunnelling → On → mode "Include"** ("only send selected apps/IPs through the
     VPN"). Include only what actually needs the tunnel — a torrent client, say. Everything
     unlisted — Caddy, the APIs, DDNS, Jellyfin — then uses the normal LAN route.
  3. Reconnect the VPN.

- [ ] **Verify the fix before continuing.** Both must be true:

```bash
ssh king@192.168.68.61 'curl -s https://api.ipify.org; echo'      # want 204.8.100.99, not 159.x
ssh king@192.168.68.61 'ip route get 1.2.3.4 from 192.168.68.61'  # want dev enp37s0, not proton0
```

Notes: app-based split tunnelling only affects apps started *after* the change, so restart anything
already running. Docker containers aren't "apps" with a path — in include mode their traffic stays
off the tunnel by default, which is what we want. The VPN app runs inside the GNOME session, so after
a headless reboot it may not connect at all; that's harmless for hosting, but it does mean routing
can differ depending on whether someone has logged in — which is exactly why the kill switch has to
be off rather than merely disconnected.

### Still open — Clerk (answer before §7)

- [ ] **1b. Which Clerk instance served production — development or production?**
      Clerk dashboard → the instance switcher. Local dev uses a **development** instance
      (`pk_test_…`, `trusted-beetle-9.clerk.accounts.dev`).
  - Development keys work on any origin — simplest, but they carry Clerk's dev limits and a
    "development mode" banner.
  - Production keys (`pk_live_…`) require the instance's domain to match the site's domain, plus
    Clerk's own DNS records (`clerk`, `accounts`, `clkmail`, …). If those records already exist for
    `myskylight.daymonhansen.com` from the Netlify era, they keep working — the hostname is unchanged.

- [ ] **1c. Does the backend's Clerk config match the instance you'll use?**
      On the Pi, check `skylight-api/.env`: `CLERK_JWKS_URL` and `CLERK_SECRET_KEY` must belong to the
      **same** Clerk instance as the frontend keys, and the JWT template named in
      `CLERK_JWT_TEMPLATE` (`skylight-api`) must exist on it. A mismatch means every API call 401s
      even though sign-in works.

> Note: `myskylight.daymonhansen.com` currently resolves to nothing, which is consistent with the
> site having lived there on a record that was removed along with the Netlify site (the backend's
> `.env.example` assumes that hostname too). Confirm in the Clerk dashboard while answering 1b. If
> that's right, the hostname isn't changing — only the IP behind it — so any Clerk domain records for
> it stay valid.

---

## 2. Prepare the desktop

> Do §1a (the VPN fix) first. Everything here works regardless, but deploying on top of the VPN
> routing produces failures that look like DNS or firewall problems.

- [ ] **2a. Install Docker** — confirmed **not** installed. `king` has no passwordless sudo, so run
      this at the desktop's own terminal (or an interactive SSH session) where you can type the
      password:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER" && newgrp docker
sudo systemctl enable --now docker
```

Confirm with `docker run --rm hello-world`. `newgrp docker` only fixes the *current* shell — log out
and back in so the group sticks, otherwise later `docker` calls fail with a permission error.

- [ ] **2b. SSH server** — already running on port 22 with key auth working, so nothing to do. (For
      reference, on a fresh box: `sudo apt install -y openssh-server && sudo systemctl enable --now ssh`.)

- [ ] **2c. Sleep — already handled, just confirm.** `sleep-inactive-ac-type` reads `nothing` and
      logind's `IdleAction` is at its default (`ignore`), so this box shouldn't auto-suspend. Worth a
      glance in Settings → Power since a GUI session can override it. Belt-and-braces if you want it
      guaranteed:

```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

Also check the BIOS/UEFI for a "restore power state after power loss" option, so the box comes back
on its own after an outage.

- [ ] **2d. Pin the LAN address.** It's currently `192.168.68.61` on `enp37s0` (DHCP). Set a
      **DHCP reservation** for that interface's MAC in the router so it can't move — the port
      forwards in §6 point at this address:

```bash
ip link show enp37s0 | awk '/link\/ether/{print $2}'   # MAC for the reservation
```

- [ ] **2e. Clone both repos side by side.** The layout matters — the Compose build context looks for
      the frontend as a sibling.

```bash
mkdir -p ~/GithubProjects && cd ~/GithubProjects
git clone https://github.com/DaymonH/HomeServerAPI.git
git clone https://github.com/DaymonH/MySkylight.git
```

- [ ] **2f. Check out the PR branches** (only needed until the PRs merge — see §7)

```bash
git -C ~/GithubProjects/HomeServerAPI checkout feat/self-host-frontend
git -C ~/GithubProjects/MySkylight checkout feat/self-host
```

- [ ] **2g. Run preflight.** Read-only; it changes nothing.

```bash
cd ~/GithubProjects/HomeServerAPI
./ops/preflight.sh
```

Fix anything marked ✗. It reports Docker state, **what owns ports 80/443**, competing reverse
proxies, Jellyfin, sshd, RAM/disk, and missing env files. Expect the `.env` warnings — §4 creates
those.

**If something already owns 80/443:** Jellyfin's default port is 8096, so plain Jellyfin doesn't
conflict. But if you previously exposed Jellyfin publicly through nginx / Nginx Proxy Manager / SWAG,
that proxy owns 443 and Caddy can't start. Pick one edge: either stop that proxy and move its
hostnames into the `Caddyfile` (there's a commented `jellyfin` block ready to uncomment), or keep it
and reverse-proxy `myskylight` through it instead of using Caddy.

---

## 3. DNS and DDNS records

The public IP is dynamic, so a DDNS updater keeps A records current. It runs on the desktop after
the move.

- [ ] **3a. At Namecheap** (Advanced DNS for `daymonhansen.com`), make sure these host records exist
      as **A + Dynamic DNS** records. The updater can only refresh a record that already exists, so
      create each one with any placeholder IP and Dynamic DNS enabled:

| Host | Purpose | Action |
|---|---|---|
| `myskylight` | the site | **create** — verified 2026-07-30 that no record exists, so there's no Netlify CNAME to remove first |
| `home` | SSH/deploy target for the desktop | create |
| `skylight-api` | API | already exists |
| `workout-api` | API | already exists |
| `landlord-api` | API | already exists |
| `pi` | old deploy target | leave for now; remove in §11 |

> If a `myskylight` CNAME ever reappears, it must be deleted before an A record can exist for the
> same host — the two record types can't coexist.
>
> **The DDNS updater must run on a host whose outbound IP is your home IP.** With the VPN routing
> unfixed (§1a) it would publish Proton's exit IP and repoint every hostname here — including the
> three APIs that work today. Re-check §1a's verification before starting the stack.

- [ ] **3b. Enable Dynamic DNS** on the domain (Advanced DNS → Dynamic DNS) and copy the password.

- [ ] **3c. Configure the updater on the desktop:**

```bash
cd ~/GithubProjects/HomeServerAPI
cp ddns/config.json.example ddns/config.json
# Set "domain" to daymonhansen.com and paste the DDNS password into every entry.
# Entries needed: myskylight, home, skylight-api, workout-api, landlord-api
```

- [ ] **3d. Confirm propagation** once the stack is up in §7: `dig +short myskylight.daymonhansen.com`
      should return your home public IP (`curl -s ifconfig.me`).

---

## 4. Environment files

Two kinds: one **root** file for the frontend, and per-service files for the APIs.

- [ ] **4a. Root `.env`** — new, and required for the frontend build:

```bash
cd ~/GithubProjects/HomeServerAPI
cp .env.example .env
```

Fill in from Clerk dashboard → API Keys (the instance you settled on in §1b):

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...   # or pk_test_...
CLERK_SECRET_KEY=sk_live_...                    # or sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/
CLERK_JWT_TEMPLATE=skylight-api
NEXT_PUBLIC_CLERK_JWT_TEMPLATE=skylight-api
```

> `NEXT_PUBLIC_*` values are **compiled into the browser bundle** at build time. Changing one later
> requires a rebuild (`./ops/deploy.sh myskylight`), not a container restart. `deploy.sh` refuses to
> build if the two keys are missing or still placeholders.

- [ ] **4b. API env files** — §5's migration script copies the real ones off the Pi. If you skip
      migration, create them from the examples and fill in by hand.

- [ ] **4c. After migration, edit `skylight-api/.env`.** These are the settings that reference the
      *old* hosting and will otherwise point at a site that no longer exists:

```env
APP_ENV=production
CORS_ORIGINS=https://myskylight.daymonhansen.com
FRONTEND_URL=https://myskylight.daymonhansen.com
```

| Setting | Why it matters |
|---|---|
| `CORS_ORIGINS` | The Pi's copy may still say `http://localhost:3000`. Requests normally arrive server-side through the frontend's proxy (same origin, so CORS doesn't apply), but the origin still needs listing for any direct browser call. |
| `FRONTEND_URL` | Where the **Google Calendar OAuth callback bounces the browser back to** (`app/routers/external.py` → `/app/family/<id>/integrations`). If it still points at the Netlify URL, connecting a Google account dead-ends on a dead domain. Defaults to `http://localhost:3000` if unset. |
| `DATABASE_URL` | Must stay the absolute container path `sqlite+aiosqlite:////app/data/myskylight.db` (four slashes). That's the mounted volume — a relative path would put the DB in the container's writable layer, where a rebuild discards it. |

- [ ] **4d. Leave `GOOGLE_REDIRECT_URI` alone.** It points at the **API** domain
      (`https://skylight-api.daymonhansen.com/api/v1/external/google/callback`), which is not moving,
      so the URI registered in Google Cloud Console stays valid. Only the frontend's hostname target
      changes hands in this migration.

- [ ] **4e. `landlord-api/.env` and `workout-api/.env`** need no edits — neither references the
      frontend. Their `DATABASE_URL` / `EXERCISES_DB_PATH` should likewise keep pointing at
      `/app/data/…`.

---

## 5. Move the data off the Pi — **downtime starts here**

This is the whole backend migration. There is no separate backend cutover: the three APIs are Python
containers built from source, so the *code* needs nothing moved — `docker compose up --build` on the
desktop produces the same images (and unlike the frontend, nothing here was ever architecture-bound,
which is why the APIs ran fine on ARM). What actually has to move is **state**:

| What | Where it lives on the Pi | Moved by |
|---|---|---|
| MySkylight database | `skylight_data` volume → `/app/data/myskylight.db` | volume copy |
| Landlord database | `landlord_data` volume → `/app/data/landlord.db` | volume copy |
| Workout database | bind mount `workout-api/data/exercises.db` | directory copy |
| API secrets (Clerk, Google OAuth, Gemini, DDNS) | gitignored `*/.env`, `ddns/config.json` | file copy |
| Database **schema** | — | nothing to do: each API runs `alembic upgrade head` on container start |

The SQLite databases are the only irreplaceable thing here. Schema upgrades happen automatically, so
if the desktop builds a newer commit than the Pi was running, the copied database is migrated forward
on first boot — which is exactly why 5d takes a snapshot first.

- [ ] **5a. Confirm the data is where you think it is — before stopping anything.** Run against the
      Pi. The whole copy is worthless if the databases aren't in the volumes:

```bash
ssh pi@192.168.68.62 'docker exec skylight_api ls -la /app/data'
ssh pi@192.168.68.62 'docker exec landlord_api ls -la /app/data'
ssh pi@192.168.68.62 'ls -la ~/HomeServerAPI/workout-api/data'
```

> The desktop and the Pi are on the same LAN, so these use the local IP on **port 22**. The `-p 2222`
> form is only for reaching the Pi from outside the house (`pi@pi.daymonhansen.com -p 2222`), where
> 2222 is the router's external forward.

Each should list a `.db` file of meaningful size. If `/app/data` is empty but the API works, the
database is in the container's writable layer instead of the volume (a relative `DATABASE_URL`) — it
would be lost on the next rebuild, so copy it out by path rather than by volume before going further.

- [ ] **5b. Run the migration** (from the desktop):

```bash
cd ~/GithubProjects/HomeServerAPI
./ops/migrate-from-pi.sh pi@192.168.68.62          # on the LAN (port 22)
# ./ops/migrate-from-pi.sh pi@pi.daymonhansen.com --port 2222   # from outside the house
```

It prompts before doing anything, then:
1. **stops the Pi's containers** — SQLite in WAL mode can't be copied consistently while a writer is
   attached, so this is deliberate downtime
2. copies the `skylight_data` and `landlord_data` volumes, `workout-api/data`, the real `.env` files,
   and `ddns/config.json`
3. refuses to overwrite non-empty local volumes, so it can't silently merge two databases

It deliberately does **not** copy Caddy's certificates — Caddy re-issues from Let's Encrypt on first
start, well inside rate limits.

- [ ] **5c. Sanity-check the copy:**

```bash
docker run --rm -v homeserverapi_skylight_data:/v:ro alpine ls -la /v
docker run --rm -v homeserverapi_landlord_data:/v:ro alpine ls -la /v
ls -la ~/GithubProjects/HomeServerAPI/workout-api/data
```

Sizes should match what 5a showed on the Pi. **Don't restart the Pi's containers** — two hosts
answering for the same names causes confusing, intermittent failures.

- [ ] **5d. Keep a snapshot outside Docker**, in case you need to start over:

```bash
docker run --rm -v homeserverapi_skylight_data:/v:ro -v "$PWD":/backup alpine \
  tar -C /v -czf /backup/skylight_data-$(date +%F).tar.gz .
```

---

## 6. Repoint the router

In the router's port-forwarding table:

- [ ] **6a.** TCP **80** → desktop LAN IP, port 80
- [ ] **6b.** TCP **443** → desktop LAN IP, port 443
- [ ] **6c.** TCP **2222** → desktop LAN IP, port **22** (keeps the existing external SSH port)
- [ ] **6d. Remove the old rules pointing at the Pi** — leaving both risks the router sending
      traffic to a dead host.

If UFW is active on the desktop: `sudo ufw allow 80,443/tcp && sudo ufw allow 22/tcp`.

---

## 7. First deploy

> **Read this before running anything.** `ops/deploy.sh` resets **both** repos to `origin/<branch>`
> before building. If you run it with the defaults while the PRs are unmerged, it will reset your
> checkouts to `main` and build the *old* code — which has no Dockerfile, so it fails.

Pick one:

- [ ] **Option A — merge the PRs first (recommended).** Merge
      [HomeServerAPI#5](https://github.com/DaymonH/HomeServerAPI/pull/5) and
      [MySkylight#2](https://github.com/DaymonH/MySkylight/pull/2) (mark them ready for review
      first), then on the desktop:

```bash
cd ~/GithubProjects/HomeServerAPI
git checkout main && git -C ../MySkylight checkout main
./ops/deploy.sh all
```

Merging first also means the GitHub Actions auto-deploy is live immediately — but note it will try to
deploy on merge, before the router/DNS work is verified. Harmless if §6 is already done; otherwise
expect a failed run and re-deploy by hand.

- [ ] **Option B — deploy from the branches, merge after verifying:**

```bash
cd ~/GithubProjects/HomeServerAPI
BRANCH=feat/self-host-frontend WEB_BRANCH=feat/self-host HEALTH_TIMEOUT=300 ./ops/deploy.sh all
```

What to expect: the first `next build` takes several minutes (later ones reuse layer cache unless
dependencies change). The script builds each service, health-checks it from inside its container,
then reloads Caddy. On a health-check failure it rolls both repos back and rebuilds the previous
state.

- [ ] **7a. Watch it come up:**

```bash
docker compose ps
docker compose logs -f caddy myskylight-web
```

Caddy issuing certificates for four new hostnames takes a minute or two. `dig` must already return
your public IP (§3d) or issuance fails — Let's Encrypt validates over HTTP on port 80.

---

## 8. Verify

- [ ] **8a. Health endpoints** (from anywhere):

```bash
curl -s https://myskylight.daymonhansen.com/api/health
curl -s https://skylight-api.daymonhansen.com/api/v1/health
curl -s https://workout-api.daymonhansen.com/health
curl -s https://landlord-api.daymonhansen.com/api/v1/health
```

`/api/health` returns `{"status":"ok","build":"<git sha>"}` — the SHA tells you which build is live.

- [ ] **8b. TLS** — all four hostnames load without a browser warning
- [ ] **8c. Sign in** at `https://myskylight.daymonhansen.com` — this is what §1b/§9 protect
- [ ] **8d. Data loads** — open a family page; that exercises browser → proxy route → `skylight-api`
      over the Docker network
- [ ] **8e. Realtime** — open `/device`, change something on `/app`, confirm the device updates
      (SSE). Watch for reconnect loops in `docker compose logs -f myskylight-web`
- [ ] **8f. The kiosk picks up the new build** — its service-worker cache name is derived from the
      frontend's git SHA, so a deploy retires the old cache. Confirm with
      `curl -s https://myskylight.daymonhansen.com/sw.js | head -1`
- [ ] **8g. Family data is intact** — check something only the real database would have (a chore
      history, a list). If this looks empty, **stop** and see Rollback
- [ ] **8h. Jellyfin still works**, locally and however you normally reach it
- [ ] **8i. Reboot test** — `sudo reboot`, then confirm everything returns on its own without you
      logging in. This catches the sleep/auto-start problems in §2c. **Then log into the desktop's
      GUI and re-check**: the Proton app lives in the GNOME session, so logging in is exactly when
      VPN routing can reassert itself. Re-run §1a's two verification commands afterwards and confirm
      the site still loads from outside the house
- [ ] **8j. The other two APIs kept their data** — load something from the workout and landlord apps
      that only a populated database could return. Their frontends live elsewhere, so it's easy to
      migrate them and never notice an empty volume until much later
- [ ] **8k. Google Calendar connect** (only if you use F18 sync) — start a connect from
      `/app/family/<id>/integrations`. It should land back on that page rather than on the old Netlify
      URL; that round trip is what proves `FRONTEND_URL` (§4c) is right. A previously connected
      account keeps syncing regardless, since its tokens are in the database

---

## 9. Clerk dashboard

- [ ] **9a. Update the webhook endpoint** — Clerk dashboard → Webhooks. Point it at
      `https://myskylight.daymonhansen.com/api/webhooks/clerk` (`docs/TRACKER.md` still has this as
      an open item). The frontend forwards these to the backend, which verifies the signature with
      `CLERK_WEBHOOK_SECRET` — that secret must match the endpoint's signing secret. Send a test
      event and confirm a 2xx.
- [ ] **9b. Only if the domain changed** (§1a) — add the new domain to the Clerk instance, create
      whatever DNS records Clerk asks for, and update the allowed redirect URLs / sign-in URLs.
- [ ] **9c. If you switched instances** (dev ↔ production) — the `skylight-api` JWT template must
      exist on the new instance, and `skylight-api/.env`'s `CLERK_JWKS_URL` + `CLERK_SECRET_KEY` must
      be updated to match, then `./ops/deploy.sh skylight`.

---

## 10. GitHub secrets — set in **both** repos

Settings → Secrets and variables → Actions. Same five values in `HomeServerAPI` and `MySkylight`
(the names keep their `PI_` prefix for continuity; only the values change):

| Secret | Value |
|---|---|
| `PI_HOST` | `home.daymonhansen.com` |
| `PI_USER` | `king` |
| `PI_SSH_PORT` | `2222` (the external port from §6c; sshd itself listens on 22) |
| `PI_SSH_KEY` | private key whose public half is in `/home/king/.ssh/authorized_keys`. Your Mac's key already works — either reuse it or generate a deploy-only pair |
| `PI_REPO_DIR` | `/home/king/GithubProjects/HomeServerAPI` — **always the HomeServerAPI path**, even in the MySkylight repo, because that's where Compose lives |

- [ ] **10a. Add/copy the deploy key** to the desktop:

```bash
# On the desktop, if reusing the Pi's key pair, paste the public key into:
nano ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
```

- [ ] **10b. Test the auto-deploy** — in the MySkylight repo, Actions → "Deploy frontend to home
      server" → Run workflow. It should SSH in, rebuild, health-check, and pass. This is also how you
      redeploy after rotating Clerk keys, since `NEXT_PUBLIC_*` changes need a rebuild.

---

## 11. Decommission the Pi

Only after §8 passes and the site has been healthy for a day or so.

- [ ] **11a.** On the Pi: `cd ~/HomeServerAPI && docker compose down`
- [ ] **11b.** Disable anything scheduled there — the throttle-monitor cron
      (`/etc/cron.d/throttle-monitor`) and any DB backup cron
- [ ] **11c.** Remove the `pi` entry from `ddns/config.json` on the desktop and delete the `pi` DNS
      record at Namecheap — **after** `PI_HOST` is switched to `home.` and a deploy has succeeded
- [ ] **11d.** Power it off. It's still useful as the wall kiosk (a browser in kiosk mode pointed at
      `/device` is well within a Pi 3B+'s ability, even though building the app isn't)

---

## 12. Housekeeping

- [ ] **12a. Confirm Netlify is fully closed out.** Deleting a site doesn't always end the
      subscription — check Billing and that no plan is still active
- [ ] **12b. Move your database backups.** The volumes live on the desktop now; any backup job on the
      Pi is backing up nothing. A nightly cron on the desktop:

```bash
0 3 * * * docker run --rm -v homeserverapi_skylight_data:/v:ro -v /home/<user>/backups:/b \
  alpine tar -C /v -czf /b/skylight-$(date +\%F).tar.gz .
```

- [ ] **12c. Kiosk on the LAN.** Some routers don't support NAT hairpinning, so a device *inside*
      the house can't reach `https://myskylight.daymonhansen.com` via the public IP. If the kiosk
      can't load the site while phones on cellular can, that's this. Fixes: enable NAT loopback if
      the router has it, or add a local DNS override (Pi-hole / router DNS / the kiosk's
      `/etc/hosts`) mapping the hostname to the desktop's LAN IP — the certificate stays valid
      because the hostname is unchanged
- [ ] **12d. Unattended security updates:** `sudo apt install -y unattended-upgrades`
- [ ] **12e. Reclaim disk periodically:** `docker image prune -f` (each frontend deploy leaves an old
      image behind)

---

## Rollback

**A deploy failed.** `deploy.sh` already restored the previous commits and rebuilt. Read the output
for the failing health check, then `docker compose logs <service>`.

**The new host is broken and you need the site back now.** Before the Pi is decommissioned:

1. Point the router's 80/443 forwards back at the Pi
2. On the Pi: `cd ~/HomeServerAPI && docker compose up -d`
3. On the desktop: `docker compose down` (never leave both running)

**The data caveat:** once the desktop has served real traffic, its database has writes the Pi's copy
doesn't. Rolling back to the Pi loses them. If that matters, copy the newer database forward first —
stop the desktop's containers, snapshot as in §5d, and restore that into the Pi's volume rather than
accepting the older copy.

**Nuclear option — start the data migration over:** `docker compose down`, then
`docker volume rm homeserverapi_skylight_data homeserverapi_landlord_data`, then re-run §5. The
migration script refuses to touch non-empty volumes, which is why removal is explicit.

---

## Command cheat sheet

```bash
cd ~/GithubProjects/HomeServerAPI

./ops/preflight.sh                 # read-only host check, safe any time
./ops/deploy.sh                    # deploy everything
./ops/deploy.sh myskylight         # frontend only (pulls MySkylight, rebuilds)
./ops/deploy.sh skylight           # one API

docker compose ps                  # what's running
docker compose logs -f myskylight-web
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile   # deploy.sh does this for you

curl -s https://myskylight.daymonhansen.com/api/health   # which build is live
```

**Where config lives now:** `HomeServerAPI/.env` (frontend + Clerk keys),
`HomeServerAPI/skylight-api/.env` (backend). There's no hosting dashboard any more — that's the
point.
