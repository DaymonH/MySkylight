#!/data/data/com.termux/files/usr/bin/sh
# MySkylight wall-display watchdog for a rooted Android tablet.
#
# Run by Termux:Boot at boot (put this file at ~/.termux/boot/kiosk.sh and make it
# executable). It keeps the screen on, opens the kiosk page in a modern browser, and
# reopens it if the browser is ever closed or pushed to the background.
#
# Needs: Termux + Termux:Boot (both from F-Droid) and root granted to Termux.
# Undo:  rm ~/.termux/boot/kiosk.sh   (and `pkill -f kiosk.sh` to stop a running copy)

PKG=com.android.chrome            # or com.kiwibrowser.browser
URL="https://myskylight.daymonhansen.com/device"

termux-wake-lock                  # stop Android from freezing Termux
su -c "svc power stayon true"     # keep the screen on while plugged in
sleep 45                          # let the system finish booting

while true; do
  front=$(su -c "dumpsys activity activities" | grep -E "topResumedActivity|mResumedActivity" | head -2)
  case "$front" in
    *"$PKG"*) ;;                  # the browser is in front: all good
    *) su -c "am start -a android.intent.action.VIEW -d '$URL' -p $PKG" ;;
  esac
  sleep 30
done
