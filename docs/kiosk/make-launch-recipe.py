#!/usr/bin/env python3
"""Rebuild the command that launches an installed Kiwi/Chrome web app (PWA) from adb.

Why this exists: a PWA added to the home screen from Kiwi is NOT a separate Android app
(no APK/package of its own). It is a pinned *shortcut* whose launch recipe -- an
`ACTION_START_WEBAPP` intent plus ~15 extras, one of which is a signature (`webapp_mac`)
over the start URL -- lives in Android's shortcut service. Nothing can start it with a
plain URL, so the kiosk watchdog replays the recipe. Run this whenever the PWA is
(re)installed, or Kiwi is reinstalled / has its data cleared, then reinstall with
`install-to-tablet.sh --recipe <file>`.

    python3 docs/kiosk/make-launch-recipe.py --out /tmp/kiosk-launch.sh

Needs: `adb` on the PATH, the tablet reachable over adb (USB, or Wireless debugging --
`adb mdns services` shows its address) and root via `su 0` (AOSP-style su).
The output contains a signature that is only valid for this install: do NOT commit it.
"""
import argparse
import re
import subprocess
import sys


def adb(serial, *args):
    cmd = ["adb"] + (["-s", serial] if serial else []) + list(args)
    out = subprocess.run(cmd, capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"adb failed ({' '.join(cmd)}): {out.stderr.strip() or out.stdout.strip()}")
    return out.stdout


def find_serial():
    """The first wireless-debugging address announced on the network, else None."""
    svc = subprocess.run(["adb", "mdns", "services"], capture_output=True, text=True).stdout
    m = re.search(r"_adb-tls-connect\._tcp\s+(\S+)", svc)
    if not m:
        return None
    subprocess.run(["adb", "connect", m.group(1)], capture_output=True, text=True)
    return m.group(1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--serial", help="adb serial / HOST:PORT (default: the only device, or the one found over mDNS)")
    ap.add_argument("--label", default="MySkylight", help="the shortcut's name on the home screen")
    ap.add_argument("--package", default="com.kiwibrowser.browser", help="browser that owns the shortcut")
    ap.add_argument("--out", help="write the launch script here (default: stdout)")
    args = ap.parse_args()

    serial = args.serial or find_serial()
    dump = adb(serial, "shell", "su 0 dumpsys shortcut")

    # Shortcut entries look like "ShortcutInfo {id=..., flags=..." ... up to the next one.
    blocks = re.split(r"(?=ShortcutInfo \{id=)", dump)
    pattern = re.compile(
        r"intents=\[Intent \{ act=(\S+) pkg=(\S+) \}/PersistableBundle\[\{(.*?)\}\]\]", re.S
    )
    found = None
    for b in blocks:
        if f"packageName={args.package}" not in b or f"shortLabel={args.label}," not in b:
            continue
        m = pattern.search(b)
        if m and "ACTION_START_WEBAPP" in m.group(1):
            found = m
            break
    if not found:
        sys.exit(
            f"No web-app shortcut labelled {args.label!r} for {args.package}. Install the site as an "
            "app in Kiwi first (open it, then menu > Add to Home screen), and make sure it is pinned."
        )
    action, pkg, body = found.group(1), found.group(2), found.group(3)

    # "key=value, key=value" -- split only at the next ", org.chromium.<key>=" so values that
    # contain commas or newlines (the base64 icon, the signature) stay whole.
    parts = re.split(r", (?=org\.chromium\.[A-Za-z_.]+=)", body)
    extras, args_out, url = {}, [], ""
    for p in parts:
        k, v = p.split("=", 1)
        extras[k] = v
        if v in ("true", "false"):
            args_out += ["--ez", k, v]
        elif re.fullmatch(r"-?\d+", v):
            args_out += ["--el" if abs(int(v)) > 2**31 - 1 else "--ei", k, v]
        else:
            args_out += ["--es", k, v]
        if k.endswith("webapp_url"):
            url = v

    q = lambda s: "'" + s.replace("'", "'\\''") + "'"
    script = "am start -a %s -p %s %s\n" % (action, pkg, " ".join(q(a) for a in args_out))

    if args.out:
        with open(args.out, "w") as f:
            f.write(script)
    else:
        sys.stdout.write(script)
    print(f"# {len(parts)} extras; app starts at {url.strip()}", file=sys.stderr)
    if not any(k.endswith("webapp_mac") for k in extras):
        print("# WARNING: no webapp_mac extra found; Kiwi may refuse to start this recipe", file=sys.stderr)


if __name__ == "__main__":
    main()
