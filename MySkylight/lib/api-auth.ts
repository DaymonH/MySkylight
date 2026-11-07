/**
 * The bridge that lets `apiRequest` — a plain module, no hooks — ask Clerk for
 * a session token so it can call the API directly instead of through the
 * Netlify proxy.
 *
 * Clerk only hands out `getToken` through React (`useAuth`), so a tiny
 * component (`ApiAuthBridge`) registers it here once Clerk has loaded. That
 * leaves one ordering problem: React runs child effects before parent ones, so
 * a page's first fetch can fire before the bridge has registered. Callers
 * therefore WAIT for the source rather than finding it missing, up to a bound
 * after which they go without — ending up at the proxy, which authenticates by
 * cookie and needs no token passed in.
 */

type TokenSource = () => Promise<string | null>

/**
 * How long a request waits for the bridge before falling back to the proxy.
 * Clerk normally loads well inside this; the bound is for the cases where it
 * never will (blocked script, signed-out page), which must not stall the app.
 * Skipped outright when the browser reports itself offline.
 */
const SOURCE_WAIT_MS = 3_000

let source: TokenSource | null = null
let announce: (() => void) | null = null
let sourceReady = new Promise<void>((resolve) => {
  announce = resolve
})

/** Called by `ApiAuthBridge`; `null` on unmount or sign-out. */
export function setTokenSource(next: TokenSource | null): void {
  source = next
  if (next) {
    announce?.()
    announce = null
  } else if (!announce) {
    sourceReady = new Promise<void>((resolve) => {
      announce = resolve
    })
  }
}

/**
 * A bearer token for the API, or `null` when there isn't one to be had.
 *
 * `null` is not an error: the request is simply sent through the proxy, which
 * is what every request did before this module existed. Clerk's `getToken` can
 * also THROW (it does when the browser is offline); that is folded into `null`.
 */
export async function getApiToken(): Promise<string | null> {
  const offline = typeof navigator !== "undefined" && !navigator.onLine
  if (!source && !offline) {
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      sourceReady,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SOURCE_WAIT_MS)
      }),
    ])
    clearTimeout(timer)
  }
  if (!source) return null
  try {
    return await source()
  } catch {
    return null
  }
}
