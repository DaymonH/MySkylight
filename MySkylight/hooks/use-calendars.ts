"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useApi } from "@/hooks/use-api"
import type {
  EventCreatePayload,
  EventOut,
  EventUpdatePayload,
  OccurrenceOut,
} from "@/lib/types/calendar"

export function useOccurrences(
  familyId: string,
  from: string,   // YYYY-MM-DD
  to: string,     // YYYY-MM-DD
  enabled = true,
) {
  const api = useApi()
  return useQuery({
    queryKey: ["occurrences", familyId, from, to],
    queryFn: () =>
      api.get<OccurrenceOut[]>(
        `/families/${familyId}/events/occurrences?from=${from}&to=${to}`,
      ),
    enabled: !!familyId && enabled,
    staleTime: 30_000,
  })
}

export function useCreateEvent(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: EventCreatePayload) =>
      api.post<EventOut>(`/families/${familyId}/events`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["occurrences", familyId] }),
  })
}

export function useUpdateEvent(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ eventId, data }: { eventId: string; data: EventUpdatePayload }) =>
      api.patch<EventOut>(`/families/${familyId}/events/${eventId}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["occurrences", familyId] }),
  })
}

export function useDeleteEvent(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ eventId, occurrenceDate }: { eventId: string; occurrenceDate?: string }) => {
      const qs = occurrenceDate ? `?occurrence_date=${occurrenceDate}` : ""
      return api.delete(`/families/${familyId}/events/${eventId}${qs}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["occurrences", familyId] }),
  })
}
