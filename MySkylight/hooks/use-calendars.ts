"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useApi } from "@/hooks/use-api"
import type {
  CalendarOut,
  EventCreatePayload,
  EventOut,
  EventUpdatePayload,
  IcsImportResult,
  OccurrenceOut,
} from "@/lib/types/calendar"

export function useCalendars(familyId: string) {
  const api = useApi()
  return useQuery({
    queryKey: ["calendars", familyId],
    queryFn: () => api.get<CalendarOut[]>(`/families/${familyId}/calendars`),
    enabled: !!familyId,
  })
}

export function useCreateCalendar(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; color?: string }) =>
      api.post<CalendarOut>(`/families/${familyId}/calendars`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["calendars", familyId] }),
  })
}

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

/**
 * Import an external `.ics` feed into a calendar (F25). The backend expects
 * exactly one source — pasted/uploaded text (`ics`) or a feed `url` it fetches
 * itself — and dedupes against `ical_uid`, so re-importing updates in place.
 * Imported events flow through the normal occurrence engine, so invalidate that
 * cache (realtime also pushes an `event.created`, but don't rely on it here).
 */
export function useImportCalendarIcs(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      calendarId,
      ics,
      url,
    }: {
      calendarId: string
      ics?: string
      url?: string
    }) =>
      api.post<IcsImportResult>(
        `/families/${familyId}/calendars/${calendarId}/import-ics`,
        url ? { url } : { ics },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["occurrences", familyId] }),
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
