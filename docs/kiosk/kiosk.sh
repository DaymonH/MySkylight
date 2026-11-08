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
# Maintenance: `touch ~/.termux/kiosk.pause` makes the watchdog stand down (remove the
# file to resume); unpin first with the usual gesture (swipe up and hold, or hold
# Back + Overview). What the watchdog does is logged to ~/.termux/kiosk.log.
# Undo:  rm ~/.termux/boot/kiosk.sh   (and `pkill -f kiosk.sh` to stop a running copy)

PKG=com.android.chrome            # the app that must be in front (its package name)
URL="https://myskylight.daymonhansen.com/device"
[ -f "$HOME/.termux/kiosk.conf" ] && . "$HOME/.termux/kiosk.conf"
LAUNCH_FILE="$HOME/.termux/kiosk-launch.sh"

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
log "watchdog started (PKG=$PKG, root=$ROOT_STYLE)"
as_root svc power stayon true     # keep the screen on while plugged in
sleep "${BOOT_DELAY:-45}"         # let the system finish booting

while true; do
  if [ ! -f "$HOME/.termux/kiosk.pause" ]; then
    front=$(as_root dumpsys activity activities | grep -E "topResumedActivity|mResumedActivity" | head -2)
    case "$front" in
      *"$PKG"*) pin ;;            # the app is in front: make sure it is pinned
      *)
        log "app not in front ($(echo "$front" | grep -o '[a-z0-9.]*/[A-Za-z0-9.]*' | head -1)); launching"
        launch
        sleep 4                   # let it come up before trying to pin it
        pin
        ;;
    esac
  fi
  sleep "${LOOP_DELAY:-30}"
done
