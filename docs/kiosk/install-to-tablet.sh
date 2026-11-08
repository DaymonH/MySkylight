#!/usr/bin/env bash
# Install (or update) the kiosk watchdog on the wall-display tablet, from the Mac, over adb.
#
#   docs/kiosk/install-to-tablet.sh [--serial HOST:PORT] [--recipe FILE] [--pkg PACKAGE]
#                                   [--restart] [--dry-run]
#
#   --serial   adb serial or HOST:PORT. Default: the wireless-debugging address found with
#              `adb mdns services` (turn Wireless debugging on first).
#   --recipe   a launch script made by make-launch-recipe.py (needed to start a PWA).
#   --pkg      browser package that must stay in front (default com.kiwibrowser.browser).
#   --restart  stop the running watchdog and start the new one now (otherwise it takes over
#              at the next reboot).
#   --dry-run  show what would be done; change nothing on the tablet.
#
# Everything lands in Termux's home (~/.termux/...) with Termux's owner and SELinux label,
# which a plain `adb push` cannot do -- files must be copied in as root and chown/chcon'd.
# See docs/kiosk/README.md.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERIAL=""; RECIPE=""; PKG="com.kiwibrowser.browser"; RESTART=0; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --serial)  SERIAL="$2"; shift 2 ;;
    --recipe)  RECIPE="$2"; shift 2 ;;
    --pkg)     PKG="$2"; shift 2 ;;
    --restart) RESTART=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

command -v adb >/dev/null || { echo "adb not found (brew install --cask android-platform-tools)" >&2; exit 1; }
if [ -z "$SERIAL" ]; then
  SERIAL=$(adb mdns services 2>/dev/null | awk '/_adb-tls-connect/ {print $NF; exit}')
  [ -n "$SERIAL" ] || { echo "No tablet found. Turn on Wireless debugging (keep its screen open) or pass --serial." >&2; exit 1; }
  adb connect "$SERIAL" >/dev/null
fi
[ -z "$RECIPE" ] || [ -f "$RECIPE" ] || { echo "recipe file not found: $RECIPE" >&2; exit 1; }
T=(adb -s "$SERIAL")
H=/data/data/com.termux/files/home

# Read-only discovery: who owns Termux's files, and what SELinux label they carry.
UID_T=$("${T[@]}" shell 'su 0 stat -c %u /data/data/com.termux' | tr -d '\r')
CTX=$("${T[@]}" shell "su 0 ls -ldZ $H/.termux" | tr -d '\r' | grep -o 'u:object_r:[^ ]*' | head -1)
[ -n "$UID_T" ] && [ -n "$CTX" ] || { echo "Termux not found, or su 0 not available." >&2; exit 1; }
echo "tablet $SERIAL | Termux uid $UID_T | label $CTX | package $PKG | restart: $RESTART"

run() { if [ "$DRY" = 1 ]; then echo "  + $*"; else "$@"; fi; }
STAGE=/sdcard/kiosk-install
printf 'PKG=%s\n' "$PKG" > "${TMPDIR:-/tmp}/kiosk.conf"

run "${T[@]}" shell "rm -rf $STAGE; mkdir -p $STAGE"
run "${T[@]}" push "$HERE/kiosk.sh" "$STAGE/kiosk.sh" >/dev/null
run "${T[@]}" push "${TMPDIR:-/tmp}/kiosk.conf" "$STAGE/kiosk.conf" >/dev/null
[ -z "$RECIPE" ] || run "${T[@]}" push "$RECIPE" "$STAGE/kiosk-launch.sh" >/dev/null

PLACE="
set -e
mkdir -p $H/.termux/boot
cp $STAGE/kiosk.sh $H/.termux/boot/kiosk.sh; chmod 700 $H/.termux/boot/kiosk.sh
cp $STAGE/kiosk.conf $H/.termux/kiosk.conf; chmod 600 $H/.termux/kiosk.conf
if [ -f $STAGE/kiosk-launch.sh ]; then cp $STAGE/kiosk-launch.sh $H/.termux/kiosk-launch.sh; chmod 600 $H/.termux/kiosk-launch.sh; fi
chown $UID_T:$UID_T $H/.termux/boot/kiosk.sh $H/.termux/kiosk.conf
[ ! -f $H/.termux/kiosk-launch.sh ] || chown $UID_T:$UID_T $H/.termux/kiosk-launch.sh
chcon $CTX $H/.termux/boot/kiosk.sh $H/.termux/kiosk.conf
[ ! -f $H/.termux/kiosk-launch.sh ] || chcon $CTX $H/.termux/kiosk-launch.sh
# The battery manager must not freeze Termux or Termux:Boot (which would kill the watchdog).
dumpsys deviceidle whitelist +com.termux >/dev/null 2>&1 || true
dumpsys deviceidle whitelist +com.termux.boot >/dev/null 2>&1 || true
cmd appops set com.termux RUN_ANY_IN_BACKGROUND allow >/dev/null 2>&1 || true
ls -lZ $H/.termux/boot/kiosk.sh
"
case "$PLACE" in *"'"*) echo "internal error: apostrophe in the on-device script" >&2; exit 1 ;; esac
run "${T[@]}" shell "su 0 sh -c '$PLACE'"
run "${T[@]}" shell "rm -rf $STAGE"
rm -f "${TMPDIR:-/tmp}/kiosk.conf"

if [ "$RESTART" = 1 ]; then
  # Two separate adb calls: a `pkill -f kiosk.sh` inside a command line that itself contains
  # "kiosk.sh" kills its own shell. The [k] trick keeps the pattern from matching its own text.
  run "${T[@]}" shell 'su 0 sh -c "for p in \$(pgrep -f \"[k]iosk.sh\"); do kill -9 \$p; done; sleep 1"'
  run "${T[@]}" shell "su 0 sh -c \"HOME=$H BOOT_DELAY=2 nohup sh $H/.termux/boot/kiosk.sh > /dev/null 2>&1 &\""
  echo "watchdog restarted. Log: su 0 cat $H/.termux/kiosk.log"
else
  echo "installed. It takes over at the next reboot (or re-run with --restart)."
fi
