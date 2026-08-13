"""Dump the live REST surface to docs/api.md — a drift-proof, committed reference.

This file is GENERATED. Never hand-edit docs/api.md. Regenerate after adding,
removing, or re-pathing any route:

    source venv/bin/activate
    make api                          # or: python scripts/dump_api.py

How it works: imports the FastAPI app (which registers every router) and walks
its route table. Importing does NOT run the lifespan, so no scheduler starts and
no network/DB I/O happens — dummy env vars below let it import without real
secrets or a .env. Output is deterministic (grouped by tag, sorted by path) so
the file only changes when the surface actually changes, keeping diffs meaningful.

Auth column: 🔒 means the route depends (directly or transitively) on
verify_clerk_token, i.e. it requires a valid Clerk JWT. A blank cell is a public
route OR one with a *different* auth scheme — notably the Clerk webhook (svix
signature) and the Google OAuth callback. Role tiers (owner/adult/child/viewer)
are enforced per-route via require_family_role and are NOT shown here; see the
router source for the exact tier.

Source of truth is still app/routers/*.py; this is a read-at-a-glance mirror so a
new session doesn't have to reconstruct the endpoint list by grepping routers.
"""

from __future__ import annotations

import os
from pathlib import Path

# Import-time config needs these (no defaults in Settings). setdefault so a real
# environment or .env still wins; the dummies just make `import app.main` work
# anywhere without secrets. APP_ENV=test is belt-and-suspenders (lifespan, which
# would start the scheduler, does not run on import anyway).
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("CLERK_JWKS_URL", "https://example.clerk.accounts.dev/.well-known/jwks.json")
os.environ.setdefault("CLERK_WEBHOOK_SECRET", "whsec_dummy")
os.environ.setdefault("CLERK_SECRET_KEY", "sk_test_dummy")
os.environ.setdefault("PIN_PEPPER", "dummy")

from fastapi.routing import APIRoute  # noqa: E402

from app.main import app  # noqa: E402

API_ROOT = Path(__file__).resolve().parent.parent  # skylight-api/
OUT_PATH = API_ROOT / "docs" / "api.md"

# Methods FastAPI adds implicitly; never interesting on their own.
_NOISE_METHODS = {"HEAD", "OPTIONS"}


def _requires_auth(route: APIRoute) -> bool:
    """True if verify_clerk_token appears anywhere in the route's dependency tree."""
    seen: set[int] = set()
    stack = [route.dependant]
    while stack:
        dep = stack.pop()
        if id(dep) in seen:
            continue
        seen.add(id(dep))
        call = getattr(dep, "call", None)
        if getattr(call, "__name__", "") == "verify_clerk_token":
            return True
        stack.extend(dep.dependencies)
    return False


def _iter_api_routes():
    """Yield (full_path, APIRoute) across the app.

    FastAPI 0.137 keeps each `include_router(...)` as a lazy `_IncludedRouter`
    wrapper in app.routes instead of flattening the child routes up. So we descend
    into each wrapper's original router and re-apply the include prefix; the route's
    own path already has any per-router prefix baked in.
    """
    for entry in app.routes:
        ctx = getattr(entry, "include_context", None)
        if ctx is not None:  # an _IncludedRouter wrapper
            prefix = ctx.prefix or ""
            for route in entry.original_router.routes:
                if isinstance(route, APIRoute):
                    yield prefix + route.path, route
        elif isinstance(entry, APIRoute):  # a route mounted directly on the app
            yield entry.path, entry
        # else: Starlette Route for /api/docs, /api/openapi.json, etc. — skip.


def collect_rows() -> list[tuple[str, str, str, bool, str]]:
    """Return (tag, path, method, requires_auth, handler) rows, one per method."""
    rows: list[tuple[str, str, str, bool, str]] = []
    for path, route in _iter_api_routes():
        tag = route.tags[0] if route.tags else "(untagged)"
        auth = _requires_auth(route)
        for method in sorted(route.methods - _NOISE_METHODS):
            rows.append((tag, path, method, auth, route.name))
    # Deterministic: by tag, then path, then method.
    rows.sort(key=lambda r: (r[0], r[1], r[2]))
    return rows


def render(rows: list[tuple[str, str, str, bool, str]]) -> str:
    lines = [
        "# MySkylight API surface",
        "",
        "<!-- AUTO-GENERATED — do not edit by hand. Regenerate with `make api`",
        "     (or `python scripts/dump_api.py`) after any router change.",
        "     Source of truth = app/routers/*.py; this is a convenience mirror. -->",
        "",
        f"**{app.title} v{app.version}** · {len(rows)} routes · 🔒 = requires Clerk JWT",
        "(blank auth = public, or a non-Clerk scheme: webhook=svix, Google callback=OAuth state).",
        "Role tiers (owner/adult/child/viewer) are per-route — see the router source.",
        "",
        "Interactive docs (dev only): `/api/docs` · `/api/redoc` · raw spec `/api/openapi.json`",
    ]
    current_tag: str | None = None
    for tag, path, method, auth, handler in rows:
        if tag != current_tag:
            current_tag = tag
            lines += ["", f"## {tag}", "", "| Method | Path | Auth | Handler |", "| --- | --- | --- | --- |"]
        lines.append(f"| {method} | `{path}` | {'🔒' if auth else ''} | `{handler}` |")
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    rows = collect_rows()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(render(rows))
    print(f"Wrote {OUT_PATH.relative_to(API_ROOT)} ({len(rows)} routes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
