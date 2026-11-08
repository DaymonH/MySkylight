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

command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock   # keep Termux alive
as_root svc power stayon true     # keep the screen on while plugged in
sleep "${BOOT_DELAY:-45}"         # let the system finish booting

while true; do
  front=$(as_root dumpsys activity activities | grep -E "topResumedActivity|mResumedActivity" | head -2)
  case "$front" in
    *"$PKG"*) ;;                  # the app is in front: all good
    *) launch ;;
  esac
  sleep "${LOOP_DELAY:-30}"
done
