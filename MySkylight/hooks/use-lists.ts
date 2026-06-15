"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useApi } from "@/hooks/use-api"
import type {
  ListCreatePayload,
  ListItemCreatePayload,
  ListItemOut,
  ListItemUpdatePayload,
  ListOut,
  ListUpdatePayload,
} from "@/lib/types/list"

// ── Lists ─────────────────────────────────────────────────────────────────────

export function useLists(familyId: string) {
  const api = useApi()
  return useQuery({
    queryKey: ["lists", familyId],
    queryFn: () => api.get<ListOut[]>(`/families/${familyId}/lists`),
    enabled: !!familyId,
  })
}

export function useCreateList(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ListCreatePayload) => api.post<ListOut>(`/families/${familyId}/lists`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lists", familyId] }),
  })
}

export function useUpdateList(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ listId, data }: { listId: string; data: ListUpdatePayload }) =>
      api.patch<ListOut>(`/families/${familyId}/lists/${listId}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lists", familyId] }),
  })
}

export function useDeleteList(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (listId: string) => api.delete(`/families/${familyId}/lists/${listId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lists", familyId] }),
  })
}

// ── Items ─────────────────────────────────────────────────────────────────────

export function useAddItem(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ listId, data }: { listId: string; data: ListItemCreatePayload }) =>
      api.post<ListItemOut>(`/families/${familyId}/lists/${listId}/items`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lists", familyId] }),
  })
}

export function useUpdateItem(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      listId,
      itemId,
      data,
    }: {
      listId: string
      itemId: string
      data: ListItemUpdatePayload
    }) => api.patch<ListItemOut>(`/families/${familyId}/lists/${listId}/items/${itemId}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lists", familyId] }),
  })
}

export function useDeleteItem(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ listId, itemId }: { listId: string; itemId: string }) =>
      api.delete(`/families/${familyId}/lists/${listId}/items/${itemId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lists", familyId] }),
  })
}

// ── Check / uncheck (optimistic) ──────────────────────────────────────────────
//
// Checking an item should feel instant on every surface, so we patch the nested
// `["lists", familyId]` cache up-front and roll back on failure. Other screens
// catch up over the `list.*` SSE event.

interface ToggleVars {
  listId: string
  itemId: string
  isChecked: boolean
}

export function useToggleItem(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ listId, itemId, isChecked }: ToggleVars) =>
      api.patch<ListItemOut>(`/families/${familyId}/lists/${listId}/items/${itemId}`, {
        is_checked: isChecked,
      }),
    onMutate: async ({ listId, itemId, isChecked }: ToggleVars) => {
      await qc.cancelQueries({ queryKey: ["lists", familyId] })
      const prev = qc.getQueryData<ListOut[]>(["lists", familyId])
      qc.setQueryData<ListOut[]>(["lists", familyId], (old) =>
        old?.map((l) =>
          l.id !== listId
            ? l
            : {
                ...l,
                items: l.items.map((it) =>
                  it.id === itemId
                    ? {
                        ...it,
                        is_checked: isChecked,
                        checked_at: isChecked ? new Date().toISOString() : null,
                      }
                    : it,
                ),
              },
        ),
      )
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["lists", familyId], ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["lists", familyId] }),
  })
}
