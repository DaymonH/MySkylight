"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useApi } from "@/hooks/use-api"
import type {
  RedemptionOut,
  RedemptionStatus,
  RewardCreatePayload,
  RewardOut,
  RewardUpdatePayload,
  StarAdjustmentOut,
  StarAdjustmentPayload,
  StarAdjustmentResult,
  StarBalanceOut,
} from "@/lib/types/reward"

// ── Queries ───────────────────────────────────────────────────────────────────

export function useRewards(familyId: string) {
  const api = useApi()
  return useQuery({
    queryKey: ["rewards", familyId],
    queryFn: () => api.get<RewardOut[]>(`/families/${familyId}/rewards`),
    enabled: !!familyId,
  })
}

export function useStarBalances(familyId: string) {
  const api = useApi()
  return useQuery({
    queryKey: ["star-balances", familyId],
    queryFn: () => api.get<StarBalanceOut[]>(`/families/${familyId}/star-balances`),
    enabled: !!familyId,
  })
}

export function useRedemptions(familyId: string, status?: RedemptionStatus) {
  const api = useApi()
  const qs = status ? `?status=${status}` : ""
  return useQuery({
    queryKey: ["redemptions", familyId, status ?? "all"],
    queryFn: () => api.get<RedemptionOut[]>(`/families/${familyId}/redemptions${qs}`),
    enabled: !!familyId,
  })
}

// ── Reward catalog mutations ──────────────────────────────────────────────────

function useInvalidateRewards(familyId: string) {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ["rewards", familyId] })
    qc.invalidateQueries({ queryKey: ["star-balances", familyId] })
    qc.invalidateQueries({ queryKey: ["redemptions", familyId] })
    qc.invalidateQueries({ queryKey: ["star-adjustments", familyId] })
  }
}

export function useCreateReward(familyId: string) {
  const api = useApi()
  const invalidate = useInvalidateRewards(familyId)
  return useMutation({
    mutationFn: (data: RewardCreatePayload) =>
      api.post<RewardOut>(`/families/${familyId}/rewards`, data),
    onSuccess: invalidate,
  })
}

export function useUpdateReward(familyId: string) {
  const api = useApi()
  const invalidate = useInvalidateRewards(familyId)
  return useMutation({
    mutationFn: ({ rewardId, data }: { rewardId: string; data: RewardUpdatePayload }) =>
      api.patch<RewardOut>(`/families/${familyId}/rewards/${rewardId}`, data),
    onSuccess: invalidate,
  })
}

export function useDeleteReward(familyId: string) {
  const api = useApi()
  const invalidate = useInvalidateRewards(familyId)
  return useMutation({
    mutationFn: (rewardId: string) => api.delete(`/families/${familyId}/rewards/${rewardId}`),
    onSuccess: invalidate,
  })
}

// ── Redemption mutations ──────────────────────────────────────────────────────

export function useRedeemReward(familyId: string) {
  const api = useApi()
  const invalidate = useInvalidateRewards(familyId)
  return useMutation({
    mutationFn: ({ rewardId, memberId }: { rewardId: string; memberId: string }) =>
      api.post<RedemptionOut>(`/families/${familyId}/rewards/${rewardId}/redeem`, {
        member_id: memberId,
      }),
    onSuccess: invalidate,
  })
}

export function useDecideRedemption(familyId: string) {
  const api = useApi()
  const invalidate = useInvalidateRewards(familyId)
  return useMutation({
    mutationFn: ({ redemptionId, approve }: { redemptionId: string; approve: boolean }) =>
      api.post<RedemptionOut>(
        `/families/${familyId}/redemptions/${redemptionId}/${approve ? "approve" : "reject"}`,
      ),
    onSuccess: invalidate,
  })
}

// ── Star corrections (parents) ────────────────────────────────────────────────

/** The correction history for one member, newest first. */
export function useStarAdjustments(familyId: string, memberId: string, enabled = true) {
  const api = useApi()
  return useQuery({
    queryKey: ["star-adjustments", familyId, memberId],
    queryFn: () =>
      api.get<StarAdjustmentOut[]>(`/families/${familyId}/star-adjustments?member_id=${memberId}`),
    enabled: enabled && !!familyId && !!memberId,
  })
}

/**
 * Correct a member's stars: add/remove an amount, or set their balance to an exact
 * number. Recorded as a ledger entry; the completions themselves are untouched.
 */
export function useAdjustStars(familyId: string) {
  const api = useApi()
  const invalidate = useInvalidateRewards(familyId)
  return useMutation({
    mutationFn: (data: StarAdjustmentPayload) =>
      api.post<StarAdjustmentResult>(`/families/${familyId}/star-adjustments`, data),
    onSettled: invalidate,
  })
}
