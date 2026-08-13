"""Family timezone API: default, set-on-create, update, read-back, and validation.

The household timezone drives DST-correct recurrence expansion (see
test_calendar.py::test_recurrence_preserves_local_time_across_dst).
"""

API = "/api/v1"


async def test_family_defaults_to_mountain_time(client, auth_headers):
    r = await client.post(f"{API}/families", json={"name": "Default"}, headers=auth_headers)
    assert r.status_code == 201, r.text
    assert r.json()["timezone"] == "America/Denver"


async def test_create_family_with_timezone(client, auth_headers):
    r = await client.post(
        f"{API}/families",
        json={"name": "NY", "timezone": "America/New_York"},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    assert r.json()["timezone"] == "America/New_York"


async def test_update_and_read_back_timezone(client, auth_headers):
    created = await client.post(f"{API}/families", json={"name": "Fam"}, headers=auth_headers)
    family_id = created.json()["id"]

    patched = await client.patch(
        f"{API}/families/{family_id}",
        json={"timezone": "Europe/London"},
        headers=auth_headers,
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["timezone"] == "Europe/London"

    got = await client.get(f"{API}/families/{family_id}", headers=auth_headers)
    assert got.json()["timezone"] == "Europe/London"


async def test_invalid_timezone_is_rejected(client, auth_headers):
    r = await client.post(
        f"{API}/families",
        json={"name": "Bad", "timezone": "Mars/Phobos"},
        headers=auth_headers,
    )
    assert r.status_code == 422, r.text
