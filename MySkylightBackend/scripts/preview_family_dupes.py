"""Preview duplicate 'Family' calendars before cleanup. Read-only."""
import sqlite3

c = sqlite3.connect("myskylight.db")
c.row_factory = sqlite3.Row

print("--- Family calendar count per family (non-deleted) ---")
for r in c.execute("""
    SELECT family_id, COUNT(*) AS n
    FROM calendars
    WHERE name = 'Family' AND deleted_at IS NULL
    GROUP BY family_id
    ORDER BY n DESC
"""):
    print(dict(r))

print("\n--- All Family calendars (id, family, created_at) ---")
for r in c.execute("""
    SELECT family_id, id, created_at
    FROM calendars
    WHERE name = 'Family' AND deleted_at IS NULL
    ORDER BY family_id, created_at, id
"""):
    print(dict(r))

print("\n--- Event distribution on Family calendars ---")
for r in c.execute("""
    SELECT c.family_id, c.id AS calendar_id, c.created_at,
           COUNT(e.id) AS event_count
    FROM calendars c
    LEFT JOIN events e ON e.calendar_id = c.id AND e.deleted_at IS NULL
    WHERE c.name = 'Family' AND c.deleted_at IS NULL
    GROUP BY c.id
    ORDER BY c.family_id, c.created_at
"""):
    print(dict(r))
