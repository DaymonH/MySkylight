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

/** A member's star ledger; `available = earned + adjustment - spent - pending`. */
export interface StarBalanceOut {
  member_id: string
  name: string
  color: string
  earned: number
  spent: number
  pending: number
  /** A parent's manual corrections (signed); already included in `available`. */
  adjustment: number
  available: number
}

/** One manual correction to a member's stars (newest first in the history). */
export interface StarAdjustmentOut {
  id: string
  member_id: string
  amount: number // signed
  note: string | null
  created_at: string
}

/** Result of correcting stars; `adjustment` is null if the balance was already right. */
export interface StarAdjustmentResult {
  adjustment: StarAdjustmentOut | null
  balance: StarBalanceOut
}

/** Give exactly one of `amount` or `set_available_to`. */
export interface StarAdjustmentPayload {
  member_id: string
  amount?: number
  set_available_to?: number
  note?: string | null
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
