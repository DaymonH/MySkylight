"use client"

import { useEffect } from "react"
import { useAuth } from "@clerk/nextjs"
import { useQueryClient } from "@tanstack/react-query"

import { setTokenSource } from "@/lib/api-auth"
import {
  clearPersistedQueryCache,
  persistedCacheBelongsTo,
} from "@/lib/query-persist"

/**
 * Hands Clerk's `getToken` to `lib/api-auth` so `apiRequest` can call the API
 * directly. Renders nothing.
 *
 * The template matches the one the proxy and the SSE stream mint with, so a
 * direct call carries the same claims a proxied one did.
 */
const JWT_TEMPLATE = process.env.NEXT_PUBLIC_CLERK_JWT_TEMPLATE || undefined

export function ApiAuthBridge() {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth()
  const queryClient = useQueryClient()

  // Keep the persisted query cache from outliving the account that produced it:
  // signing out drops it, and so does finding it was written by someone else.
  useEffect(() => {
    if (!isLoaded) return
    if (!isSignedIn || !userId) {
      queryClient.clear()
      clearPersistedQueryCache()
      return
    }
    if (!persistedCacheBelongsTo(userId)) {
      queryClient.clear()
      clearPersistedQueryCache()
      persistedCacheBelongsTo(userId)
    }
  }, [isLoaded, isSignedIn, userId, queryClient])

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return
    setTokenSource(() =>
      getToken(JWT_TEMPLATE ? { template: JWT_TEMPLATE } : undefined),
    )
    return () => setTokenSource(null)
  }, [isLoaded, isSignedIn, getToken])

  return null
}
