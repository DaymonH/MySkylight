const CACHE = "myskylight-v2"

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
        )
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

  // Cache-first for Next.js static chunks, fonts, and icons
  if (
    url.pathname.startsWith("/_next/static") ||
    /\.(png|jpg|jpeg|svg|ico|woff2?)$/.test(url.pathname)
  ) {
    e.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached
        return fetch(request).then((res) => {
          if (res.ok)
            caches.open(CACHE).then((c) => c.put(request, res.clone()))
          return res
        })
      })
    )
  }
})
