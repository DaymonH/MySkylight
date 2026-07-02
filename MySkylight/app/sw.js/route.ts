// Service worker served from a route (not /public) so we can bake a per-deploy
// cache name into it. Every deploy → a unique CACHE → the SW's `activate` step
// deletes every older cache, so devices never run a fresh HTML shell against
// stale `/_next/static` chunks (the version skew that dropped UI like the
// "Add an account" buttons). Paired with the auto-reload in <PwaRegister>, an
// always-on kiosk swaps itself onto the new build with no manual reload.

// Netlify exposes the git SHA as COMMIT_REF at build time; fall back to any
// unique per-build value so each deploy still gets a fresh cache name.
const BUILD_ID =
  process.env.COMMIT_REF ??
  process.env.BUILD_ID ??
  process.env.DEPLOY_ID ??
  `dev-${Date.now()}`

// Prerendered at build, so BUILD_ID is baked into the emitted file (one stable
// value per deploy) rather than re-evaluated per request.
export const dynamic = "force-static"

const SW = `const CACHE = "myskylight-${BUILD_ID}"

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener("fetch", (e) => {
  const { request } = e
  const url = new URL(request.url)

  // Never intercept non-GET or API requests
  if (request.method !== "GET" || url.pathname.startsWith("/api/")) return

  // Network-first for HTML navigation — fall back to cached page if offline
  if (request.mode === "navigate") {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(request, copy))
          return res
        })
        .catch(() => caches.match(request))
    )
    return
  }

  // Cache-first for immutable hashed Next.js chunks, fonts, and icons
  if (
    url.pathname.startsWith("/_next/static") ||
    /\\.(png|jpg|jpeg|svg|ico|woff2?)$/.test(url.pathname)
  ) {
    e.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached
        return fetch(request).then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone()))
          return res
        })
      })
    )
  }
})
`

export function GET() {
  return new Response(SW, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      // Always revalidate the SW script itself so update checks see new bytes
      // (a new deploy's new BUILD_ID) promptly.
      "Cache-Control": "no-cache",
      "Service-Worker-Allowed": "/",
    },
  })
}
