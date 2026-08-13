# MySkylight backend (skylight-api) — common dev tasks.
# Activate the venv first: `source venv/bin/activate`.
.PHONY: docs schema api test migrate run

# Regenerate both committed reference mirrors (docs/schema.sql + docs/api.md).
# Run after any model/migration/router change so a new session reads accurate docs.
docs: schema api

# Regenerate the committed schema reference (docs/schema.sql) from the migration chain.
# Run after any model/migration change so the mirror stays accurate.
schema:
	python scripts/dump_schema.py

# Regenerate the committed REST-surface reference (docs/api.md) from the FastAPI app.
# Run after adding/removing/re-pathing any route.
api:
	python scripts/dump_api.py

# Test suite (in-memory sqlite, mocked Clerk — see tests/conftest.py).
test:
	pytest

# Apply migrations to the local dev DB.
migrate:
	alembic upgrade head

# Dev server on :8001.
run:
	uvicorn app.main:app --port 8001 --reload
