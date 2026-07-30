# Migration runbook — Netlify → home server

**Goal:** MySkylight's frontend stops running on Netlify (which billed ~$26/month for function
invocations) and runs on the home Ubuntu desktop instead, alongside the APIs. The Raspberry Pi 3B+ is
retired as a host and everything consolidates onto one machine.

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
- [ ] **Desktop** — terminal access, and `sudo`
- [ ] **GitHub** — repo settings → secrets, for both repos

---

## 1. Verify four facts first — they change later steps

Don't skip this. Getting §9 wrong is the most likely way to end up with a site that loads but won't
let anyone sign in.

- [ ] **1a. What domain was the live site on?**
      Check Namecheap → Domain List → `daymonhansen.com` → Advanced DNS, and look for a `myskylight`
      record (likely a CNAME pointing at Netlify).
  - **`myskylight.daymonhansen.com`** → the domain isn't changing, only where it points. Clerk's
    domain configuration stays valid. This is the easy path and what the PRs assume.
  - **A `*.netlify.app` address** → you're introducing a new public domain. Add §9b's Clerk domain
    setup, and expect new DNS records for Clerk itself.

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

- [ ] **1d. Desktop basics** — Ubuntu version, LAN IP, whether Docker is installed, and what's
      listening on 80/443. §2 gets you all of this.

---

## 2. Prepare the desktop

- [ ] **2a. Install Docker** (skip if `docker --version` works)

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER" && newgrp docker
sudo systemctl enable --now docker
```

- [ ] **2b. SSH server** — the auto-deploy needs it

```bash
sudo apt update && sudo apt install -y openssh-server
sudo systemctl enable --now ssh
```

- [ ] **2c. Stop the desktop from sleeping.** This is the single most common way a repurposed
      desktop fails as a server — it works, then goes unreachable overnight.

```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
# On a GNOME desktop, also turn off automatic suspend while on AC power:
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing'
```

Also check the BIOS/UEFI for a "restore power state after power loss" option, so the box comes back
on its own after an outage.

- [ ] **2d. Give it a fixed LAN address.** Find it, then set a DHCP reservation for that MAC in the
      router (easier than static config on the host):

```bash
ip -4 route get 1.1.1.1 | awk '{print $7}'   # LAN IP
ip link | grep -A1 'state UP'                # MAC address
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
| `myskylight` | the site | **Delete the old Netlify CNAME**, create an A record |
| `home` | SSH/deploy target for the desktop | create |
| `skylight-api` | API | already exists |
| `workout-api` | API | already exists |
| `landlord-api` | API | already exists |
| `pi` | old deploy target | leave for now; remove in §11 |

> A `myskylight` **CNAME** to Netlify must be deleted before an A record can exist for the same host.

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

- [ ] **4c. After migration, edit `skylight-api/.env`:**

```env
APP_ENV=production
CORS_ORIGINS=https://myskylight.daymonhansen.com
```

The Pi's copy may still say `APP_ENV=development` / `CORS_ORIGINS=http://localhost:3000`. Requests
normally arrive server-side through the frontend's proxy (same origin, so CORS doesn't apply), but
the origin still needs listing for any direct browser call.

---

## 5. Move the data off the Pi — **downtime starts here**

The SQLite databases are the only irreplaceable thing in this migration.

- [ ] **5a. Run the migration** (from the desktop):

```bash
cd ~/GithubProjects/HomeServerAPI
./ops/migrate-from-pi.sh pi@192.168.68.62 --port 2222
```

It prompts before doing anything, then:
1. **stops the Pi's containers** — SQLite in WAL mode can't be copied consistently while a writer is
   attached, so this is deliberate downtime
2. copies the `skylight_data` and `landlord_data` volumes, `workout-api/data`, the real `.env` files,
   and `ddns/config.json`
3. refuses to overwrite non-empty local volumes, so it can't silently merge two databases

It deliberately does **not** copy Caddy's certificates — Caddy re-issues from Let's Encrypt on first
start, well inside rate limits.

- [ ] **5b. Sanity-check the copy:**

```bash
docker run --rm -v homeserverapi_skylight_data:/v:ro alpine ls -la /v
```

You should see `myskylight.db` with a non-trivial size. **Don't restart the Pi's containers** — two
hosts answering for the same names causes confusing, intermittent failures.

- [ ] **5c. Keep a snapshot outside Docker**, in case you need to start over:

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
      logging in. This catches the sleep/auto-start problems in §2c

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
| `PI_USER` | your Ubuntu username |
| `PI_SSH_PORT` | `2222` (the external port from §6c) |
| `PI_SSH_KEY` | private key whose public half is in the desktop's `~/.ssh/authorized_keys` |
| `PI_REPO_DIR` | `/home/<user>/GithubProjects/HomeServerAPI` — **always the HomeServerAPI path**, even in the MySkylight repo, because that's where Compose lives |

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
stop the desktop's containers, snapshot as in §5c, and restore that into the Pi's volume rather than
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
