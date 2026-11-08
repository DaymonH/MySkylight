"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { useApi } from "@/hooks/use-api"
import { ApiError } from "@/lib/api-client"
import {
  currentSubscription,
  notificationPermission,
  pushSupport,
  subscribeThisDevice,
  unsubscribeThisDevice,
  type PushPrefs,
  type PushSubscriptionOut,
  type PushSupport,
} from "@/lib/push"

export interface PushState {
  support: PushSupport
  permission: NotificationPermission
  /** This phone's registration on the server, or null if it hasn't opted in. */
  subscription: PushSubscriptionOut | null
  /** The browser-side endpoint (needed to send a test). */
  endpoint: string | null
}

const key = (familyId: string) => ["push-state", familyId] as const

/**
 * Where this phone stands with notifications. A query (not an effect that sets state)
 * because it touches `navigator`, which only exists on the client, and because a
 * stale answer should refresh when the page is revisited.
 */
export function usePushState(familyId: string) {
  const api = useApi()
  return useQuery<PushState>({
    queryKey: key(familyId),
    enabled: !!familyId,
    // Always ask the browser and server again; never serve a persisted copy.
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const support = pushSupport()
      const permission = notificationPermission()
      const browserSub = support === "supported" ? await currentSubscription() : null
      let subscription: PushSubscriptionOut | null = null
      if (browserSub) {
        try {
          subscription = await api.get<PushSubscriptionOut>(
            `/families/${familyId}/push/subscription?endpoint=${encodeURIComponent(browserSub.endpoint)}`,
          )
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 404)) throw err
        }
      }
      return { support, permission, subscription, endpoint: browserSub?.endpoint ?? null }
    },
  })
}

/** Turn notifications on for this phone, or change which kinds it gets. */
export function useSavePush(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (prefs: PushPrefs) => subscribeThisDevice(api, familyId, prefs),
    onSettled: () => qc.invalidateQueries({ queryKey: key(familyId) }),
  })
}

export function useDisablePush(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => unsubscribeThisDevice(api, familyId),
    onSettled: () => qc.invalidateQueries({ queryKey: key(familyId) }),
  })
}

/** Send a test notification to this phone. Resolves to the push service's verdict. */
export function useTestPush(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (endpoint: string) =>
      api.post<{ result: "ok" | "gone" | "failed" }>(`/families/${familyId}/push/test`, {
        endpoint,
      }),
    // A "gone" result deletes the registration server-side; reflect that.
    onSettled: () => qc.invalidateQueries({ queryKey: key(familyId) }),
  })
}
