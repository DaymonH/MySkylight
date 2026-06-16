import type { MemberBrief } from "@/lib/types/calendar"

export type RedemptionStatus = "pending" | "approved" | "rejected"

export interface RewardOut {
  id: string
  family_id: string
  name: string
  description: string | null
  star_cost: number
  icon: string | null
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

/** A member's star ledger; `available = earned - spent - pending`. */
export interface StarBalanceOut {
  member_id: string
  name: string
  color: string
  earned: number
  spent: number
  pending: number
  available: number
}

export interface RewardBrief {
  id: string
  name: string
  icon: string | null
}

export interface RedemptionOut {
  id: string
  family_id: string
  reward_id: string
  member_id: string
  star_cost: number
  status: RedemptionStatus
  decided_at: string | null
  created_at: string
  member: MemberBrief | null
  reward: RewardBrief | null
}

export interface RewardCreatePayload {
  name: string
  description?: string | null
  star_cost: number
  icon?: string | null
  sort_order?: number
  is_active?: boolean
}

export type RewardUpdatePayload = Partial<RewardCreatePayload>
