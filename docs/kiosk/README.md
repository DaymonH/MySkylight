# Wall-display kiosk tablet — setup & runbook

How the MySkylight wall display (`/device`) is run on the actual tablet, why it is set up this
way, and how to operate, repair or rebuild it. Written 2026-11-08 after a long debugging
session; **read this before changing anything kiosk-related** — most obvious approaches
(Fully Kiosk, a plain Chrome tab, `su -c`) do not work on this hardware.

## TL;DR

- The tablet runs the **MySkylight PWA inside Kiwi Browser**, full-screen, **pinned** (Android
  screen pinning) so swipes can't leave it.
- A small **root watchdog** (`kiosk.sh`, started at boot by Termux:Boot) keeps it that way: it
  keeps the screen on, relaunches the app if it is closed or crashes, and re-pins it.
- **You are never locked out:** unpin with the normal gesture and the watchdog stands down for
  30 minutes (see [Getting out](#getting-out-to-change-settings)).
- Everything tablet-specific is reproducible from this folder + the commands below.

## The hardware and ROM (verified over adb)

| Fact | Value |
|---|---|
| Model / board | **WF3205T**, Rockchip **RK3588** wall tablet |
| Android | **12** (SDK 32), `arm64-v8a` (+ `armeabi-v7a`, `armeabi`) |
| Build | `CUH-WF3205T-R116-V1.1B-32-P6.1-H1.0-20240807`, **`userdebug`** (`ro.debuggable=1`) |
| Root | AOSP-style `/system/xbin/su`: **`su 0 <command>`** works, **`su -c "…"` does NOT** (`su: invalid uid/gid '-c'`). No Magisk. |
| Launcher | `com.android.launcher3` (Quickstep). Lock screen is disabled (needed for unattended recovery). |
| System WebView | **only `com.android.webview` 95.0.4638.74 is allowed** (see below) |
| Pre-installed MDM | **Hexnode** — asks for a "server" at boot. Harmless; left untouched. |
| Termux | `com.termux` (F-Droid build), uid **10090** (`u0_a90`), plus **Termux:Boot** (`com.termux.boot`) |
| Browsers | Kiwi `com.kiwibrowser.browser` (runs the PWA), Chrome `com.android.chrome` (149.x) |

## Why it is built this way (decisions and dead ends)

1. **Fully Kiosk Browser can't render the site.** Fully uses the system WebView. This ROM's
   WebView allow-list contains only the built-in `com.android.webview` **v95**, and Google's
   Android System WebView (156, installed from APKMirror) is *not selectable* — `dumpsys
   webviewupdate` lists only the built-in one. The site's CSS (Tailwind v4) needs **Chrome ≥ ~111**:
   it wraps almost everything in `@layer` (Chrome 99+) and uses `color-mix()`/`lab()` (111+).
   On v95 the layered rules are ignored → **unstyled HTML**. Fixing it means editing the system
   (replace the built-in WebView or overlay `config_webview_packages`) — risky, not done.
   Kiwi/Chrome ship their own engine, so they render fine.
2. **A plain browser tab works but shows the address bar**, so the site is installed as a PWA.
3. **Chrome could not install the PWA; Kiwi could.** `/manifest.json` and `/device-manifest.json`
   were behind the Clerk login (`proxy.ts`) and returned 404 to the credential-less fetch
   browsers use for manifests, so Chrome never offered "Install app". The fix is PR #11 on this
   repo (make just those two files public) — check whether it has merged. Kiwi's "Add to Home
   screen" works regardless.
4. **A Kiwi PWA is not a separate Android app.** There is no APK/package for it. It is a pinned
   *shortcut* (Android ShortcutManager) whose launch recipe — an `ACTION_START_WEBAPP` intent
   with ~15 extras including a signature over the start URL — lives in `dumpsys shortcut`. A URL
   intent can't start it, so `make-launch-recipe.py` extracts the recipe and the watchdog replays
   it with `am start`. (The window then *animates toward the Kiwi icon* instead of the
   MySkylight icon when minimised, because it wasn't started from the home-screen shortcut. That
   is cosmetic; it is the same app.)
5. **The installed PWA currently points at `https://myskylight.netlify.app/sign-in?redirect_url=…/device`**
   (it was installed from the Netlify address, at the sign-in page). It works: the API's CORS
   allows both `myskylight.netlify.app` and `myskylight.daymonhansen.com`. The login is stored
   per origin. To switch to the custom domain, open `https://myskylight.daymonhansen.com/device`
   in Kiwi while signed in → menu → *Add to Home screen*, then regenerate the recipe (below).
6. **Auth/cookies.** Clerk is a *development* instance (`trusted-beetle-9`, `cookieless_dev`,
   `single_session_mode`). A browser that won't keep cookies gets an endless
   handshake-redirect loop and Clerk eventually shows a bare error page — it looks like "the
   site renders as plain HTML". Make sure the browser keeps cookies and nothing clears its data.
   Session lifetime is a Clerk-dashboard setting (already raised). Long-term, device pairing
   (F12) would remove the kiosk's dependence on a Clerk login.
7. **Kiwi is no longer maintained** (no security fixes). Accepted for a single-site wall display
   on the home network; Chrome is the maintained alternative once the manifests are public.

## How it works

```
power on ─▶ Hexnode splash ─▶ Termux:Boot runs ~/.termux/boot/kiosk.sh  (as the Termux user)
                                  │  waits BOOT_DELAY (45 s), keeps the screen on
                                  ▼  every LOOP_DELAY (30 s), using `su 0 …` for root:
        pause file? ─ yes ─▶ do nothing
        unpinned by hand (PINNED→NONE, app process alive)? ─▶ stand down UNPIN_PAUSE_MINUTES (30)
        Settings/Termux in front? ─▶ stand down up to MAINT_MINUTES (15)
        kiosk app in front?       ─▶ make sure it is pinned (am task lock <taskId>)
        otherwise                 ─▶ launch it (replay kiosk-launch.sh), wait 4 s, pin it
```

## Files

| In the repo (`docs/kiosk/`) | Purpose |
|---|---|
| `kiosk.sh` | The watchdog. Copied to the tablet as `~/.termux/boot/kiosk.sh`. |
| `make-launch-recipe.py` | Reads the PWA shortcut from the tablet over adb and writes the `am start …` launch script. |
| `install-to-tablet.sh` | Mac-side installer: copies the watchdog/config/recipe into Termux's home with the right owner and SELinux label, whitelists Termux from battery limits. |

| On the tablet (Termux home, `/data/data/com.termux/files/home/.termux/`) | Purpose |
|---|---|
| `boot/kiosk.sh` | the watchdog (started by Termux:Boot) |
| `kiosk.conf` | per-tablet settings, sourced by the watchdog: `PKG=com.kiwibrowser.browser`; optional `URL`, `PIN`, `MAINT_PKGS`, `MAINT_MINUTES`, `UNPIN_PAUSE_MINUTES`, `LOOP_DELAY`, `BOOT_DELAY` |
| `kiosk-launch.sh` | the PWA launch recipe (**not committed**: contains a signature valid only for this install) |
| `kiosk.log` | what the watchdog did (launches, pins, pauses) — start here when debugging |
| `kiosk.pause` | if this file exists the watchdog does nothing (deleted at boot) |

## Getting out to change settings

The app is pinned and relaunched on purpose, so there are deliberate ways out:

| You want to… | Do this |
|---|---|
| Open Settings / turn on Wireless debugging | **Unpin** (swipe up and hold, or hold Back + Overview). The watchdog notices and stands down for 30 min — go to Settings. While Settings or Termux is in front it also leaves you alone (≤15 min). |
| Stop the auto-start for a while | In Termux: `touch ~/.termux/kiosk.pause` (remove the file to resume). Cleared automatically at the next reboot. |
| Stop the watchdog now | `pkill -f kiosk.sh` in Termux, or `su 0 sh -c 'pkill -f kiosk.sh'` |
| Turn it off for good | `rm ~/.termux/boot/kiosk.sh` (and `pkill -f kiosk.sh`), or uninstall Termux:Boot |
| Turn pinning off but keep the relaunching | `PIN=0` in `kiosk.conf` |
| Recover if everything went wrong | Reboot: you get ~45 s before the watchdog starts. Or from the Mac: `adb … shell 'su 0 am task lock stop'` |

Outside those stand-down windows, going to the **home screen** does not count as maintenance —
the watchdog relaunches the app within ~30 s. That is deliberate: it is how a crashed app
recovers. (Right after an unpin you have the full 30 minutes, home screen included.)

## Setting up from scratch (or rebuilding)

Everything below is driven **from the Mac** with `adb`, so nothing needs typing on the tablet.

1. **Mac:** `brew install --cask android-platform-tools`
2. **Tablet:** Developer options → turn on **Wireless debugging** (keep that screen open; it
   switched itself off when the screen was closed and after every reboot). Find the tablet with
   `adb mdns services` (look for `_adb-tls-connect`) and `adb connect <ip:port>`. The port
   changes each time. It accepted the connection without a pairing prompt.
3. **Tablet:** install **Termux** and **Termux:Boot** from **F-Droid** (not the Play Store). Open
   Termux:Boot once. In your root manager nothing is needed (`su 0` needs no prompt on this ROM).
4. **Tablet (Kiwi):** open `https://myskylight.daymonhansen.com/device`, sign in, menu → *Add to
   Home screen*. Open the new "MySkylight" icon once.
5. **Mac:** generate the recipe and install:
   ```sh
   python3 docs/kiosk/make-launch-recipe.py --out /tmp/kiosk-launch.sh   # reads the shortcut over adb
   docs/kiosk/install-to-tablet.sh --recipe /tmp/kiosk-launch.sh --restart
   rm /tmp/kiosk-launch.sh
   ```
6. **Test:** the app should open full-screen and become pinned within ~10 s. Check
   `adb … shell 'su 0 cat /data/data/com.termux/files/home/.termux/kiosk.log'`. Then close it
   (unpin first or `am force-stop com.kiwibrowser.browser`) and confirm it comes back, then
   **reboot** and confirm the whole chain starts by itself.
7. Switch **Wireless debugging off** when done (see Security).

Updating just the script later: `docs/kiosk/install-to-tablet.sh --restart` (no `--recipe` needed;
the existing recipe is kept).

## adb cheat sheet and pitfalls (all hit during setup)

- Root is `su 0 <cmd>`. For several commands: `adb -s <ip:port> shell 'su 0 sh -c "…"'`.
- **macOS has no `timeout`** — use `perl -e 'alarm 30; exec @ARGV' adb …`. In zsh, a `for f in $var`
  loop does not word-split; use `bash -c`.
- **`pkill -f kiosk.sh` inside a command line that itself contains "kiosk.sh" kills its own shell.**
  Use the `[k]iosk.sh` pattern and keep stop/start in separate `adb` calls (the installer does).
- Files copied into Termux's home as root need `chown 10090:10090` and
  `chcon u:object_r:app_data_file:s0:c90,c256,c512,c768` (the label comes from `ls -ldZ`).
- Read state: `dumpsys activity activities | grep -E "topResumedActivity|mLockTaskModeState"`
  (front app and pin state: `NONE` / `PINNED`). Pin by hand: `su 0 am task lock <taskId>`;
  release: `su 0 am task lock stop`. The task id is the `t<N>` at the end of the ActivityRecord.
- Battery: `su 0 dumpsys deviceidle whitelist +com.termux` (+ `.boot`).

## Troubleshooting

| Symptom | Likely cause / what to check |
|---|---|
| Site shows as **plain unstyled HTML** | Browser engine too old (needs ≥ ~111). Fully/system WebView here is v95. Use Kiwi/Chrome. |
| Site never loads, or a bare error page | Browser isn't keeping cookies → Clerk handshake loop. Check the browser's cookie/clear-on-exit settings. |
| App isn't relaunched after closing | Is the watchdog alive? `su 0 pgrep -f '[k]iosk.sh'`. Termux:Boot opened at least once? `kiosk.pause` present? Check `kiosk.log`. |
| App opens but isn't pinned | `settings get system lock_to_app_enabled` should be `1`; see `kiosk.log` (`pin skipped: … not the top activity` means Hexnode/something else was in front at that moment; the next loop re-pins). |
| Launch does nothing / opens a normal tab | The recipe is stale (Kiwi reinstalled / data cleared / PWA reinstalled). Re-run `make-launch-recipe.py` + the installer. |
| `su: invalid uid/gid '-c'` | AOSP su: use `su 0 <command>`. (The watchdog autodetects both styles.) |
| Can't get to Settings | Unpin (swipe up and hold), then open Settings within the stand-down window; or reboot and be quick; or `touch ~/.termux/kiosk.pause`. |

## Security notes

- **Wireless debugging gives root to any device on the Wi-Fi** — this ROM let a Mac connect with
  no pairing prompt, and `adb` here has `su 0`. Keep it **off** except when working on the tablet.
- The watchdog runs as root via Termux; only Termux's uid can change its files.
- `kiosk-launch.sh` holds a signature tied to the Kiwi install; it is deliberately not in the repo.
- Kiwi is unmaintained (see above).

## Open items

- PR #11 (public manifests) — would let Chrome install the PWA too; helps the phone apps.
- Clerk is a development instance: session lifetime/limits; moving to production = frontend keys
  **and** backend `CLERK_JWKS_URL`/`CLERK_SECRET_KEY` together (`docs/NETLIFY-SETUP.md`).
- Device pairing (F12) would make the kiosk independent of a Clerk login.
- Idea not built: an in-app "pause auto-start" prompt shown on each start (would need a small
  local helper on the tablet; the unpin-to-pause behaviour covers the need without it).
- Optional: reinstall the PWA from the custom domain so the kiosk and the other devices share an origin.
