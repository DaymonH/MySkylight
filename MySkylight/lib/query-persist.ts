import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister"

/**
 * Persists the TanStack Query cache to localStorage so a cold launch (phone
 * opened for the first time today, kiosk rebooted) paints the last-known
 * calendar, chores and lists immediately and then revalidates in the
 * background, instead of starting from empty spinners.
 *
 * Restored queries come back already stale (`staleTime` is 30s), so they paint
 * but still refetch on mount — stale-while-revalidate, never stale-instead-of.
 */
export const PERSIST_STORAGE_KEY = "skylight:query-cache"
const PERSIST_USER_KEY = "skylight:query-cache-user"

/** Past this age a persisted cache is discarded rather than shown. */
export const PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Changes on every deploy (Netlify's COMMIT_REF, see next.config.ts), so a new
 * build never hydrates data shaped by the previous one.
 */
export const PERSIST_BUSTER = process.env.NEXT_PUBLIC_BUILD_SHA ?? "dev"

function safeStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined
  try {
    // Touching localStorage throws in some private/blocked-storage modes.
    window.localStorage.getItem(PERSIST_STORAGE_KEY)
    return window.localStorage
  } catch {
    return undefined
  }
}

export function createQueryPersister() {
  return createSyncStoragePersister({
    storage: safeStorage(),
    key: PERSIST_STORAGE_KEY,
    // Coalesce the write burst an SSE-driven kiosk produces.
    throttleTime: 2_000,
  })
}

/** Drops the persisted copy. Called on sign-out and when the account changes. */
export function clearPersistedQueryCache() {
  try {
    window.localStorage.removeItem(PERSIST_STORAGE_KEY)
    window.localStorage.removeItem(PERSIST_USER_KEY)
  } catch {
    // storage unavailable — nothing was persisted
  }
}

/**
 * Whether the persisted cache belongs to `userId`. Records the owner on first
 * use. A device handed to a different account must not paint the previous
 * account's family data, even for the instant before the refetch lands.
 */
export function persistedCacheBelongsTo(userId: string): boolean {
  try {
    const owner = window.localStorage.getItem(PERSIST_USER_KEY)
    if (owner === userId) return true
    window.localStorage.setItem(PERSIST_USER_KEY, userId)
    return owner === null
  } catch {
    return true
  }
}
