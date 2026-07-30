import { NextResponse } from "next/server"

// Liveness probe for the container. `ops/deploy.sh myskylight` polls this from
// inside the container after a deploy and rolls back if it never passes, and the
// Dockerfile's HEALTHCHECK uses it too. Already listed as a public route in
// proxy.ts, so it answers without a Clerk session.
//
// Deliberately shallow: it reports that *this* process is serving requests, not
// that the backend is reachable. A backend outage shouldn't roll back a good
// frontend deploy — skylight-api has its own health check for that.
export const dynamic = "force-dynamic"

export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      // Set at build time from the git SHA (see Dockerfile), so a response
      // identifies which build is actually running.
      build: process.env.COMMIT_REF ?? "unknown",
    },
    { headers: { "cache-control": "no-store" } },
  )
}
