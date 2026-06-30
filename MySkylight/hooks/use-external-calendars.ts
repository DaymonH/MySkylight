"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useApi } from "@/hooks/use-api"
import type {
  AuthorizeUrlOut,
  ExternalAccountOut,
  ExternalSyncResult,
  IcsFeedConnectIn,
} from "@/lib/types/external"

/** Connected external accounts for the family, each with its discovered calendars. */
export function useExternalAccounts(familyId: string) {
  const api = useApi()
  return useQuery({
    queryKey: ["external-accounts", familyId],
    queryFn: () =>
      api.get<ExternalAccountOut[]>(`/families/${familyId}/external/accounts`),
    enabled: !!familyId,
  })
}

/**
 * Start the Google OAuth connect. The backend returns a consent URL; the caller
 * sends the browser there. Google redirects back to the integrations page
 * (`?external=connected|error`), so there's nothing to invalidate here.
 */
export function useGoogleAuthorize(familyId: string) {
  const api = useApi()
  return useMutation({
    mutationFn: () =>
      api.post<AuthorizeUrlOut>(`/families/${familyId}/external/google/authorize`),
  })
}

/** Connect an iCloud account with an Apple ID + app-specific password (CalDAV). */
export function useConnectApple(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { apple_id: string; app_password: string }) =>
      api.post<ExternalAccountOut>(
        `/families/${familyId}/external/apple/connect`,
        data,
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["external-accounts", familyId] }),
  })
}

/**
 * Subscribe to a read-only iCalendar (.ics) feed by URL (e.g. a US-Holidays
 * calendar). The backend validates + records it as a synced calendar and kicks an
 * immediate background pull; the scheduler keeps it fresh thereafter. Refresh the
 * accounts list and the occurrence cache (events start appearing).
 */
export function useConnectIcsFeed(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: IcsFeedConnectIn) =>
      api.post<ExternalAccountOut>(
        `/families/${familyId}/external/ics/connect`,
        data,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["external-accounts", familyId] })
      qc.invalidateQueries({ queryKey: ["occurrences", familyId] })
    },
  })
}

/** Disconnect an account (soft-delete). Already-mirrored events are left in place. */
export function useDisconnectExternalAccount(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (accountId: string) =>
      api.delete(`/families/${familyId}/external/accounts/${accountId}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["external-accounts", familyId] }),
  })
}

/**
 * Turn read-only mirroring of a discovered external calendar on or off. Enabling
 * re-pulls its events on the next sync; disabling hides them. Either way refresh
 * the accounts list and the occurrence cache.
 */
export function useSetCalendarSync(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ extCalId, synced }: { extCalId: string; synced: boolean }) =>
      api.put(`/families/${familyId}/external/calendars/${extCalId}`, { synced }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["external-accounts", familyId] })
      qc.invalidateQueries({ queryKey: ["occurrences", familyId] })
    },
  })
}

/** Pull an account's mapped calendars into their local mirrors right now. */
export function useSyncExternalAccount(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (accountId: string) =>
      api.post<ExternalSyncResult>(
        `/families/${familyId}/external/accounts/${accountId}/sync`,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["external-accounts", familyId] })
      qc.invalidateQueries({ queryKey: ["occurrences", familyId] })
    },
  })
}

/**
 * Queue a full, reconciling re-pull that clears stale duplicate mirror rows the
 * source no longer has. Returns immediately (202) — the heavy pull runs on the
 * server and the device refreshes over the realtime feed when it finishes.
 */
export function useResyncExternalAccount(familyId: string) {
  const api = useApi()
  return useMutation({
    mutationFn: (accountId: string) =>
      api.post<{ status: string }>(
        `/families/${familyId}/external/accounts/${accountId}/resync`,
      ),
  })
}

/**
 * Collapse leftover duplicate read-only mirror events to one copy each — the
 * catch-all for stale rows an old migration left behind that the sync reconcile
 * can't reach. Pure DB on the server, so it returns the count removed right away.
 */
export function useCleanupDuplicateEvents(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      api.post<{ removed: number }>(
        `/families/${familyId}/external/cleanup-duplicates`,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["occurrences", familyId] })
    },
  })
}
