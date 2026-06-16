"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useApi } from "@/hooks/use-api"
import type {
  RedemptionOut,
  RedemptionStatus,
  RewardCreatePayload,
  RewardOut,
  RewardUpdatePayload,
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
