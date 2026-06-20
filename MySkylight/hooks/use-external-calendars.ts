"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useApi } from "@/hooks/use-api"
import type {
  AuthorizeUrlOut,
  ExternalAccountOut,
  ExternalSyncResult,
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
