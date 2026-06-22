"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useApi } from "@/hooks/use-api"
import type {
  RotationOverrideOut,
  RotationOverrideScope,
  RoutineCreatePayload,
  RoutineOut,
  RoutineUpdatePayload,
  StreakOut,
  TaskCreatePayload,
  TaskOccurrenceOut,
  TaskOut,
  TaskUpdatePayload,
} from "@/lib/types/task"

// ── Routines ────────────────────────────────────────────────────────────────

export function useRoutines(familyId: string) {
  const api = useApi()
  return useQuery({
    queryKey: ["routines", familyId],
    queryFn: () => api.get<RoutineOut[]>(`/families/${familyId}/routines`),
    enabled: !!familyId,
  })
}

export function useCreateRoutine(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: RoutineCreatePayload) =>
      api.post<RoutineOut>(`/families/${familyId}/routines`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["routines", familyId] }),
  })
}

export function useUpdateRoutine(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ routineId, data }: { routineId: string; data: RoutineUpdatePayload }) =>
      api.patch<RoutineOut>(`/families/${familyId}/routines/${routineId}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["routines", familyId] }),
  })
}

export function useDeleteRoutine(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    // Deleting a routine un-groups its tasks server-side (they aren't deleted).
    mutationFn: (routineId: string) => api.delete(`/families/${familyId}/routines/${routineId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["routines", familyId] })
      qc.invalidateQueries({ queryKey: ["tasks", familyId] })
      qc.invalidateQueries({ queryKey: ["task-occurrences", familyId] })
    },
  })
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export function useTasks(familyId: string) {
  const api = useApi()
  return useQuery({
    queryKey: ["tasks", familyId],
    queryFn: () => api.get<TaskOut[]>(`/families/${familyId}/tasks`),
    enabled: !!familyId,
  })
}

export function useTaskOccurrences(
  familyId: string,
  from: string, // YYYY-MM-DD
  to: string, // YYYY-MM-DD
  enabled = true,
) {
  const api = useApi()
  return useQuery({
    queryKey: ["task-occurrences", familyId, from, to],
    queryFn: () =>
      api.get<TaskOccurrenceOut[]>(
        `/families/${familyId}/tasks/occurrences?from=${from}&to=${to}`,
      ),
    enabled: !!familyId && enabled,
    staleTime: 30_000,
  })
}

export function useCreateTask(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: TaskCreatePayload) =>
      api.post<TaskOut>(`/families/${familyId}/tasks`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks", familyId] })
      qc.invalidateQueries({ queryKey: ["routines", familyId] })
      qc.invalidateQueries({ queryKey: ["task-occurrences", familyId] })
    },
  })
}

export function useUpdateTask(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, data }: { taskId: string; data: TaskUpdatePayload }) =>
      api.patch<TaskOut>(`/families/${familyId}/tasks/${taskId}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks", familyId] })
      qc.invalidateQueries({ queryKey: ["routines", familyId] })
      qc.invalidateQueries({ queryKey: ["task-occurrences", familyId] })
      qc.invalidateQueries({ queryKey: ["task-streak", familyId] })
    },
  })
}

export function useDeleteTask(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (taskId: string) => api.delete(`/families/${familyId}/tasks/${taskId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks", familyId] })
      qc.invalidateQueries({ queryKey: ["routines", familyId] })
      qc.invalidateQueries({ queryKey: ["task-occurrences", familyId] })
    },
  })
}

// ── Completion (optimistic) ─────────────────────────────────────────────────
//
// Checking a chore should feel instant on the wall display, so we patch the
// occurrence cache up-front and roll back if the request fails. `setQueriesData`
// targets every cached date range for the family (the board queries a single day,
// but the management page may hold others).

interface CompletionVars {
  taskId: string
  memberId: string
  occurrenceDate: string
}

export function useCompleteTask(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, memberId, occurrenceDate }: CompletionVars) =>
      api.post(`/families/${familyId}/tasks/${taskId}/complete`, {
        member_id: memberId,
        occurrence_date: occurrenceDate,
      }),
    onMutate: async ({ taskId, memberId, occurrenceDate }: CompletionVars) => {
      await qc.cancelQueries({ queryKey: ["task-occurrences", familyId] })
      const prev = qc.getQueriesData<TaskOccurrenceOut[]>({
        queryKey: ["task-occurrences", familyId],
      })
      qc.setQueriesData<TaskOccurrenceOut[]>(
        { queryKey: ["task-occurrences", familyId] },
        (old) =>
          old?.map((o) =>
            o.task_id === taskId &&
            o.occurrence_date === occurrenceDate &&
            !o.completed_member_ids.includes(memberId)
              ? { ...o, completed_member_ids: [...o.completed_member_ids, memberId] }
              : o,
          ),
      )
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      ctx?.prev?.forEach(([key, data]) => qc.setQueryData(key, data))
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["task-occurrences", familyId] })
      qc.invalidateQueries({ queryKey: ["task-streak", familyId] })
    },
  })
}

export function useUncompleteTask(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, memberId, occurrenceDate }: CompletionVars) =>
      api.delete(
        `/families/${familyId}/tasks/${taskId}/complete?member_id=${memberId}&occurrence_date=${occurrenceDate}`,
      ),
    onMutate: async ({ taskId, memberId, occurrenceDate }: CompletionVars) => {
      await qc.cancelQueries({ queryKey: ["task-occurrences", familyId] })
      const prev = qc.getQueriesData<TaskOccurrenceOut[]>({
        queryKey: ["task-occurrences", familyId],
      })
      qc.setQueriesData<TaskOccurrenceOut[]>(
        { queryKey: ["task-occurrences", familyId] },
        (old) =>
          old?.map((o) =>
            o.task_id === taskId && o.occurrence_date === occurrenceDate
              ? {
                  ...o,
                  completed_member_ids: o.completed_member_ids.filter((id) => id !== memberId),
                }
              : o,
          ),
      )
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      ctx?.prev?.forEach(([key, data]) => qc.setQueryData(key, data))
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["task-occurrences", familyId] })
      qc.invalidateQueries({ queryKey: ["task-streak", familyId] })
    },
  })
}

// ── Rotation overrides (swap / skip — F27) ──────────────────────────────────

interface OverrideVars {
  taskId: string
  occurrenceDate: string // YYYY-MM-DD
  memberId: string | null // null = skip
  scope?: RotationOverrideScope
}

export function useSetRotationOverride(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, occurrenceDate, memberId, scope = "occurrence" }: OverrideVars) =>
      api.put<RotationOverrideOut[]>(
        `/families/${familyId}/tasks/${taskId}/overrides/${occurrenceDate}`,
        { member_id: memberId, scope },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task-occurrences", familyId] })
      qc.invalidateQueries({ queryKey: ["task-streak", familyId] })
    },
  })
}

export function useClearRotationOverride(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      taskId,
      occurrenceDate,
      scope = "occurrence",
    }: Pick<OverrideVars, "taskId" | "occurrenceDate" | "scope">) =>
      api.delete(
        `/families/${familyId}/tasks/${taskId}/overrides/${occurrenceDate}?scope=${scope}`,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task-occurrences", familyId] })
      qc.invalidateQueries({ queryKey: ["task-streak", familyId] })
    },
  })
}

// ── Streaks ─────────────────────────────────────────────────────────────────

export function useStreak(
  familyId: string,
  taskId: string,
  memberId: string,
  enabled = true,
) {
  const api = useApi()
  return useQuery({
    queryKey: ["task-streak", familyId, taskId, memberId],
    queryFn: () =>
      api.get<StreakOut>(`/families/${familyId}/tasks/${taskId}/streak?member_id=${memberId}`),
    enabled: !!familyId && !!taskId && !!memberId && enabled,
    staleTime: 60_000,
  })
}
