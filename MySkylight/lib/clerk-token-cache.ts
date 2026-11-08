/**
 * Minted Clerk tokens, cached for as long as they're actually valid.
 *
 * `getToken({ template })` is not free: per Clerk's docs on the backend auth
 * object, "providing a template name triggers a network request, which counts
 * toward backend API rate limits". So every API call the proxy made — a tab
 * mount fires five, the log page up to thirteen — paid a round trip to Clerk
 * *before* the round trip to the Pi. Tokens are good for a minute; re-minting
 * one per request was pure waste.
 *
 * Server-only, and deliberately its own module rather than locals in the route
 * handler: handing one user's token to another would be a serious bug, so this
 * wants to be directly testable.
 *
 * Lifetime is one warm serverless instance. That's the point — it's a
 * best-effort warm-path optimisation, and a cold instance simply mints again.
 */

type CachedToken = { token: string; expiresAt: number };

const tokenCache = new Map<string, CachedToken>();

/** Re-mint this far before real expiry so a token can't die in flight. */
const EXPIRY_SKEW_MS = 10_000;

/** Used only when a token's `exp` can't be read. Clerk's own TTL is 60s. */
const FALLBACK_TTL_MS = 45_000;

/** One warm instance serves one household; this is a leak guard, not a policy. */
const MAX_ENTRIES = 32;

/**
 * The cache key. Both parts matter: the user, obviously, and the template,
 * because tokens minted from different templates carry different claims and
 * are not interchangeable.
 */
export function tokenCacheKey(userId: string, template?: string): string {
  return `${userId}:${template ?? ""}`;
}

/**
 * When the token itself says it expires, in epoch ms. Read out of the JWT
 * rather than assumed, so a change to Clerk's TTL can't leave us serving dead
 * tokens for 45 seconds.
 */
export function tokenExpiryFromJwt(token: string): number | null {
  const segments = token.split(".");
  if (segments.length !== 3) return null;
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(segments[1], "base64url").toString("utf8"),
    );
    const exp = (payload as { exp?: unknown })?.exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** A still-valid cached token for this key, or null. */
export function readCachedToken(key: string): string | null {
  const hit = tokenCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    tokenCache.delete(key);
    return null;
  }
  return hit.token;
}

export function rememberToken(key: string, token: string): void {
  const fromToken = tokenExpiryFromJwt(token);
  const expiresAt =
    fromToken !== null ? fromToken - EXPIRY_SKEW_MS : Date.now() + FALLBACK_TTL_MS;
  // Already past it — clock skew, or a template with a very short TTL. Caching
  // it would mean every request took the miss path *and* paid a Map write.
  if (expiresAt <= Date.now()) return;

  for (const [k, v] of tokenCache) {
    if (v.expiresAt <= Date.now()) tokenCache.delete(k);
  }
  if (tokenCache.size >= MAX_ENTRIES) {
    // Oldest insertion first, which Map iteration order gives us for free.
    const oldest = tokenCache.keys().next();
    if (!oldest.done) tokenCache.delete(oldest.value);
  }
  tokenCache.set(key, { token, expiresAt });
}

/** Test seam. */
export function __clearTokenCache(): void {
  tokenCache.clear();
}

/** Test seam. */
export function __tokenCacheSize(): number {
  return tokenCache.size;
}
