"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useApi } from "@/hooks/use-api"
import { isRetryableTransportError } from "@/lib/api-client"
import type {
  BalanceApplyResult,
  BalancePlan,
  BalancePlanRequest,
} from "@/lib/types/balance"
import type {
  MissedClearOut,
  OccurrenceMoveOut,
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

// The device talks to the Pi backend over a home DDNS link that can reset or time
// out mid-request (see the proxy's 20s abort + the Pi's power quirks). Both
// override writes are idempotent — PUT sets the override for a date, DELETE clears
// it — so a lost *response* is safe to re-send: retrying turns a phantom failure
// (write landed, reply didn't) into a real success. 4xx is never retried.
const RETRY_TRANSPORT = {
  retry: (failureCount: number, error: unknown) =>
    isRetryableTransportError(error) && failureCount < 3,
  retryDelay: (attempt: number) => Math.min(400 * 2 ** attempt, 3000),
} as const

export function useSetRotationOverride(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    ...RETRY_TRANSPORT,
    mutationFn: ({ taskId, occurrenceDate, memberId, scope = "occurrence" }: OverrideVars) =>
      api.put<RotationOverrideOut[]>(
        `/families/${familyId}/tasks/${taskId}/overrides/${occurrenceDate}`,
        { member_id: memberId, scope },
      ),
    // Reconcile on settle, not just success: if we give up after retries but the
    // write actually landed (SSE will confirm), refetching shows the true state
    // instead of leaving the board stale under a suppressed error.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["task-occurrences", familyId] })
      qc.invalidateQueries({ queryKey: ["task-streak", familyId] })
    },
  })
}

export function useClearRotationOverride(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    ...RETRY_TRANSPORT,
    mutationFn: ({
      taskId,
      occurrenceDate,
      scope = "occurrence",
    }: Pick<OverrideVars, "taskId" | "occurrenceDate" | "scope">) =>
      api.delete(
        `/families/${familyId}/tasks/${taskId}/overrides/${occurrenceDate}?scope=${scope}`,
      ),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["task-occurrences", familyId] })
      qc.invalidateQueries({ queryKey: ["task-streak", familyId] })
    },
  })
}

// ── Move to today (re-phase a recurring chore's cadence) ─────────────────────
//
// Re-anchors the chore's recurrence to today so subsequent instances follow its
// cadence from today (fixes "did the missed chore today, but it still wants
// tomorrow"). Optionally completes today for the acting member (the Missed-row
// flow). Both effects are idempotent, so re-sending over the flaky Pi link is safe.

interface MoveToTodayVars {
  taskId: string
  memberId?: string | null // set = also complete today for that member
}

export function useMoveTaskToToday(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    ...RETRY_TRANSPORT,
    mutationFn: ({ taskId, memberId = null }: MoveToTodayVars) =>
      api.post<TaskOut>(`/families/${familyId}/tasks/${taskId}/move-to-today`, {
        member_id: memberId,
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["task-occurrences", familyId] })
      qc.invalidateQueries({ queryKey: ["tasks", familyId] })
      qc.invalidateQueries({ queryKey: ["task-streak", familyId] })
    },
  })
}

// ── Chore balancer ────────────────────────────────────────────────────────────

/**
 * Compute (without applying) a balanced day / who-starts plan plus a before→after
 * preview. Pure-DB on the server, so it returns the plan right away; bump the
 * request's `seed` to ask for a different balanced layout ("regenerate").
 */
export function useBalancePlan(familyId: string) {
  const api = useApi()
  return useMutation({
    mutationFn: (req: BalancePlanRequest) =>
      api.post<BalancePlan>(`/families/${familyId}/tasks/balance-plan`, req),
  })
}

/**
 * Apply the balanced plan for these inputs (deterministic per seed) in one write,
 * then refresh tasks + occurrences so the new days/assignees show up everywhere.
 */
export function useApplyBalancePlan(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: BalancePlanRequest) =>
      api.post<BalanceApplyResult>(`/families/${familyId}/tasks/balance-plan/apply`, req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks", familyId] })
      qc.invalidateQueries({ queryKey: ["routines", familyId] })
      qc.invalidateQueries({ queryKey: ["task-occurrences", familyId] })
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

// ── Clear missed (dismiss without stars) ─────────────────────────────────────

/**
 * Sweep every missed chore up to and including `through` off the board. This is
 * NOT a completion — nothing is starred, and streaks still see the miss. Pass the
 * previous value (or null) back to undo. A PUT of a single value, so it's safe to
 * retry on a transport blip.
 */
export function useClearMissed(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    ...RETRY_TRANSPORT,
    mutationFn: (through: string | null) =>
      api.put<MissedClearOut>(`/families/${familyId}/missed-chores`, { through }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["task-occurrences", familyId] })
    },
  })
}

// ── Do it tomorrow (move one occurrence) ─────────────────────────────────────

/**
 * Push a single occurrence to a later day without touching the series' cadence
 * (unlike "Move to today", which re-phases it). The original date shows nothing and
 * the new date shows the chore. A PUT to a fixed key, so safe to retry on a blip.
 */
export function useMoveOccurrence(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    ...RETRY_TRANSPORT,
    mutationFn: ({
      taskId,
      occurrenceDate,
      toDate,
    }: {
      taskId: string
      occurrenceDate: string
      toDate: string
    }) =>
      api.put<OccurrenceMoveOut>(
        `/families/${familyId}/tasks/${taskId}/occurrences/${occurrenceDate}/move`,
        { to_date: toDate },
      ),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["task-occurrences", familyId] })
      qc.invalidateQueries({ queryKey: ["task-streak", familyId] })
    },
  })
}

/** Undo a move, by the occurrence's ORIGINAL date. */
export function useClearOccurrenceMove(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    ...RETRY_TRANSPORT,
    mutationFn: ({ taskId, occurrenceDate }: { taskId: string; occurrenceDate: string }) =>
      api.delete(`/families/${familyId}/tasks/${taskId}/occurrences/${occurrenceDate}/move`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["task-occurrences", familyId] })
      qc.invalidateQueries({ queryKey: ["task-streak", familyId] })
    },
  })
}
