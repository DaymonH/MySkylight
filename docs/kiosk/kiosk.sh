#!/data/data/com.termux/files/usr/bin/sh
# MySkylight wall-display watchdog for a rooted Android tablet.
#
# Run by Termux:Boot at boot (put this file at ~/.termux/boot/kiosk.sh and make it
# executable). It keeps the screen on, opens the kiosk page, and reopens it if the
# app is ever closed or pushed to the background.
#
# Needs: Termux + Termux:Boot (both from F-Droid) and root granted to Termux.
# Root styles: works with AOSP-style `su 0 <command>` (engineering/userdebug builds)
# and with Magisk-style `su -c "<command>"`; it detects which one this device has.
#
# Per-tablet settings go in ~/.termux/kiosk.conf (sourced if present), e.g.
#     PKG=com.kiwibrowser.browser
# and, to start an installed web app (PWA) instead of a plain browser tab, put the
# command that launches it in ~/.termux/kiosk-launch.sh (run as root).
#
# The app is kept PINNED (Android screen pinning), so the home/recents gestures can't
# leave it: it is pinned after every launch, and re-pinned if it is in front but has
# been unpinned. Set PIN=0 in kiosk.conf to turn pinning off.
# Getting out to change settings (you are never locked out):
#   * UNPIN with the usual gesture (swipe up and hold, or hold Back + Overview). Only a
#     person can do that, so the watchdog reads it as "maintenance": it stands down for
#     UNPIN_PAUSE_MINUTES (default 30) -- no relaunch, no re-pin -- which is plenty of
#     time to open Settings and switch on Wireless debugging. It resumes by itself after.
#     (A crash is different: the app process dies, so it is relaunched and re-pinned.)
#   * Settings and Termux (MAINT_PKGS) are also left alone while one of them is in front,
#     for up to MAINT_MINUTES (default 15), even if the app was never pinned.
#   * To stop it indefinitely: `touch ~/.termux/kiosk.pause` (remove it to resume), or
#     `pkill -f kiosk.sh`. A reboot clears the pause file and gives you BOOT_DELAY (45s)
#     before the watchdog starts.
# What the watchdog does is logged to ~/.termux/kiosk.log.
# Undo:  rm ~/.termux/boot/kiosk.sh   (and `pkill -f kiosk.sh` to stop a running copy)

PKG=com.android.chrome            # the app that must be in front (its package name)
URL="https://myskylight.daymonhansen.com/device"
[ -f "$HOME/.termux/kiosk.conf" ] && . "$HOME/.termux/kiosk.conf"
LAUNCH_FILE="$HOME/.termux/kiosk-launch.sh"
MAINT_PKGS="${MAINT_PKGS:-com.android.settings com.termux}"   # apps you may use for maintenance
MAINT_MINUTES="${MAINT_MINUTES:-15}"                          # ...for at most this long
UNPIN_PAUSE_MINUTES="${UNPIN_PAUSE_MINUTES:-30}"              # stand down this long after a manual unpin

if su 0 true >/dev/null 2>&1; then ROOT_STYLE=aosp; else ROOT_STYLE=magisk; fi
as_root() {
  if [ "$ROOT_STYLE" = aosp ]; then su 0 "$@"; else su -c "$*"; fi
}

launch() {
  if [ -f "$LAUNCH_FILE" ]; then
    as_root sh "$LAUNCH_FILE"
  else
    as_root am start -a android.intent.action.VIEW -d "$URL" -p "$PKG"
  fi
}

LOG="$HOME/.termux/kiosk.log"
log() {
  echo "$(date '+%F %T') $*" >> "$LOG"
  # keep the log small: drop the oldest half once it passes ~200 KB
  [ "$(wc -c < "$LOG" 2>/dev/null || echo 0)" -gt 200000 ] && tail -n 400 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
}

lockstate() {   # NONE | PINNED | LOCKED
  as_root dumpsys activity activities | grep -i mLockTaskModeState | head -1 | sed 's/.*=//' | tr -d ' \r'
}

# Pin the app's task if it is in front and not already pinned.
pin() {
  [ "${PIN:-1}" = 1 ] || return 0
  [ "$(lockstate)" = NONE ] || return 0
  task=$(as_root dumpsys activity activities | grep "topResumedActivity" | head -1 | grep "$PKG" | sed -n 's/.* t\([0-9][0-9]*\)}.*/\1/p')
  if [ -n "$task" ]; then
    as_root am task lock "$task" >/dev/null 2>&1
    log "pinned task $task -> $(lockstate)"
  else
    log "pin skipped: $PKG is not the top activity"
  fi
}

command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock   # keep Termux alive
rm -f "$HOME/.termux/kiosk.pause"   # a pause lasts until the next restart
log "watchdog started (PKG=$PKG, root=$ROOT_STYLE)"
as_root svc power stayon true     # keep the screen on while plugged in
sleep "${BOOT_DELAY:-45}"         # let the system finish booting

away_since=""                     # when a maintenance app first came to the front
prev_lock=NONE                    # the pin state at the previous check
paused_until=0                    # epoch seconds; set when someone unpins on purpose
while true; do
  if [ ! -f "$HOME/.termux/kiosk.pause" ]; then
    lock=$(lockstate)
    now=$(date +%s)
    # Pinned -> unpinned while the app's process is still alive = a person did it.
    if [ "$prev_lock" = PINNED ] && [ "$lock" = NONE ] && as_root pidof "$PKG" >/dev/null 2>&1; then
      paused_until=$((now + UNPIN_PAUSE_MINUTES * 60))
      log "unpinned by hand: standing down for $UNPIN_PAUSE_MINUTES min (until $(date -d @$paused_until '+%T' 2>/dev/null || echo later))"
    fi
    prev_lock=$lock
    if [ "$now" -lt "$paused_until" ]; then
      sleep "${LOOP_DELAY:-30}"; continue
    fi

    front=$(as_root dumpsys activity activities | grep -E "topResumedActivity|mResumedActivity" | head -2)
    top_pkg=$(echo "$front" | head -1 | sed -n 's/.* u[0-9]* \([A-Za-z0-9._]*\)\/.*/\1/p')
    maint=0
    case " $MAINT_PKGS " in *" $top_pkg "*) [ -n "$top_pkg" ] && maint=1 ;; esac

    if [ "$maint" = 1 ]; then
      now=$(date +%s)
      [ -z "$away_since" ] && { away_since=$now; log "maintenance: $top_pkg in front, standing down for up to $MAINT_MINUTES min"; }
      if [ $((now - away_since)) -lt $((MAINT_MINUTES * 60)) ]; then
        sleep "${LOOP_DELAY:-30}"; continue
      fi
      log "maintenance window over ($MAINT_MINUTES min); taking the screen back"
    fi
    [ "$maint" = 0 ] && away_since=""

    case "$front" in
      *"$PKG"*) pin ;;            # the app is in front: make sure it is pinned
      *)
        log "app not in front (${top_pkg:-?}); launching"
        launch
        sleep 4                   # let it come up before trying to pin it
        pin
        prev_lock=$(lockstate)
        ;;
    esac
  fi
  sleep "${LOOP_DELAY:-30}"
done
