"""Ad-hoc, read-only CalDAV diagnostic for the Apple-sync timeout.

Run inside the container (no app imports — pure httpx + sqlite3):

    docker exec skylight_api python /app/scripts/caldav_diag.py

Pulls the stored iCloud credential + first mapped calendar from the DB, does a
full sync-collection REPORT, then times calendar-multiget REPORTs of increasing
size so we can see whether the multiget works and how slow iCloud is. Prints the
Apple ID but never the app-specific password.
"""

import re
import sqlite3
import time

import httpx

DB = "/app/data/myskylight.db"

db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row
acct = db.execute(
    "SELECT account_email, refresh_token FROM external_accounts "
    "WHERE provider='apple' AND deleted_at IS NULL LIMIT 1"
).fetchone()
cals = db.execute(
    "SELECT name, external_id, sync_token FROM external_calendars WHERE calendar_id IS NOT NULL"
).fetchall()
if not acct or not cals:
    print("missing account or mapped calendar:", bool(acct), bool(cals))
    raise SystemExit

user, pw = acct["account_email"], acct["refresh_token"]
print(f"account: {user} | mapped calendars: {len(cals)}")

SYNC = (
    '<?xml version="1.0" encoding="utf-8"?>'
    '<d:sync-collection xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
    "<d:sync-token></d:sync-token><d:sync-level>1</d:sync-level>"
    "<d:prop><d:getetag/></d:prop></d:sync-collection>"
)
HDR = {"Depth": "1", "Content-Type": "application/xml; charset=utf-8"}


def multiget_body(hrefs):
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
        "<d:prop><d:getetag/><c:calendar-data/></d:prop>"
        + "".join("<d:href>%s</d:href>" % h for h in hrefs)
        + "</c:calendar-multiget>"
    )


cal = cals[0]
url = cal["external_id"]
print(f"\n--- calendar: {cal['name']}\nurl: {url}")

with httpx.Client(auth=(user, pw), timeout=httpx.Timeout(20.0, read=60.0), follow_redirects=True) as h:
    t = time.time()
    r = h.request("REPORT", url, content=SYNC.encode(), headers=HDR)
    print(
        "SYNC-COLLECTION status=%s in %.1fs bytes=%d"
        % (r.status_code, time.time() - t, len(r.text))
    )
    hrefs = re.findall(r"<[^>]*href>\s*([^<\s]+\.ics)\s*</", r.text)
    print("changed/listed resources:", len(hrefs))

    for n in (1, 5, 25):
        batch = hrefs[:n]
        if not batch:
            break
        t = time.time()
        try:
            r2 = h.request("REPORT", url, content=multiget_body(batch).encode(), headers=HDR)
            print(
                "MULTIGET n=%d -> status=%s in %.1fs bytes=%d VEVENTs=%d"
                % (n, r2.status_code, time.time() - t, len(r2.text), r2.text.count("BEGIN:VEVENT"))
            )
        except Exception as e:  # noqa: BLE001 — diagnostic: surface whatever failed
            print("MULTIGET n=%d -> EXCEPTION after %.1fs: %r" % (n, time.time() - t, e))
