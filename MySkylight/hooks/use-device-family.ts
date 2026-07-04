"use client"

import { useUser } from "@clerk/nextjs"
import { useQuery } from "@tanstack/react-query"

import { useApi } from "@/hooks/use-api"
import { ApiError } from "@/lib/api-client"

export interface Membership {
  id: string
  family_id: string
  role: "owner" | "adult" | "child" | "viewer"
}

export type DeviceFamilyStatus =
  | "loading"
  | "reconnecting"
  | "unauthorized"
  | "ready"

export interface DeviceFamily {
  isLoaded: boolean
  familyId: string | undefined
  status: DeviceFamilyStatus
}

// A dropped/refused connection or the proxy's 20s timeout surfaces as a 502
// ("Backend unavailable"); a genuinely-gone session surfaces as a 401. Only the
// latter is a real "logged out" — everything else is a blip to ride out.
const isAuthError = (error: unknown) =>
  error instanceof ApiError && error.status === 401

/**
 * Membership lookup for the wall-mounted `/device` kiosk.
 *
 * The kiosk sits on one page for days, so it must ride out the backend blips
 * this setup is prone to — Pi brown-outs, DDNS flaps, the 20s proxy timeout —
 * rather than fall over on the first failed request. So a failed fetch is
 * treated as *transient* (retry, then poll until the Pi returns) and reported
 * as `reconnecting`; only a persistent 401 becomes `unauthorized`. Callers must
 * never leave `/device` for anything but `unauthorized`.
 */
export function useDeviceFamily(): DeviceFamily {
  const { user, isLoaded } = useUser()
  const api = useApi()

  const query = useQuery({
    queryKey: ["me", "memberships"],
    queryFn: () => api.get<Membership[]>("/me/memberships"),
    enabled: isLoaded && !!user,
    // Surface a real 401 quickly (one retry, in case a token refresh raced);
    // give transient/backend errors a few tries before we settle to `error`.
    retry: (failureCount, error) =>
      isAuthError(error) ? failureCount < 1 : failureCount < 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8_000),
    // Once settled to `error` on a backend blip, keep polling so the display
    // heals itself when the Pi comes back — no manual reload needed. Don't poll
    // a 401: that needs re-auth, which the gate handles.
    refetchInterval: (q) => {
      if (q.state.status !== "error") return false
      return isAuthError(q.state.error) ? false : 5_000
    },
  })

  const familyId = query.data?.[0]?.family_id

  let status: DeviceFamilyStatus
  if (isLoaded && !user) status = "unauthorized"
  else if (familyId) status = "ready"
  else if (query.isError && isAuthError(query.error)) status = "unauthorized"
  else if (query.isError) status = "reconnecting"
  else status = "loading"

  return { isLoaded, familyId, status }
}
