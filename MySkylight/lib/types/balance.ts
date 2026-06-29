// Chore balancer — picks each recurring chore's day + who-starts to even out the
// family's load. Mirrors app/schemas/task.py (BalancePlan* models) on the backend.

import type { AssignmentStrategy, RotationUnit } from "@/lib/types/task"

/** rotate = split between the chosen people · fixed = always one person · keep = leave as-is. */
export type BalanceMode = "rotate" | "fixed" | "keep"

export interface BalanceItemInput {
  task_id: string
  mode: BalanceMode
  effort: number // 1 = light, 2 = medium, 3 = heavy
  lock_day: boolean
  fixed_member_id?: string | null
}

export interface BalancePlanRequest {
  member_ids: string[] // people to share the load, in roster order
  items: BalanceItemInput[]
  allowed_weekdays?: number[] | null // 0=Mon … 6=Sun; null/empty = all 7
  shares?: number[] | null // per-person target share (aligned to member_ids); null = even
  horizon_days?: number
  seed?: number
}

export interface BalanceChange {
  task_id: string
  title: string
  rrule: string | null
  start_date: string
  assignment_strategy: AssignmentStrategy
  rotation_unit: RotationUnit
  rotation_interval: number
  rotation_anchor_date: string | null
  member_ids: string[]
  weekday: number | null // placed weekday (single-day weekly chores)
  starter_id: string | null // who takes the first occurrence
  summary: string // e.g. "Tuesdays · Alex starts"
}

export interface BalancePerson {
  member_id: string
  name: string
  color: string
  before_per_week: number
  after_per_week: number
}

export interface BalancePreview {
  people: BalancePerson[]
  // 7 entries, Mon→Sun; each maps member_id → that weekday's average effort.
  weekday_loads: Record<string, number>[]
  busiest_before: number
  busiest_after: number
  imbalance_before: number
  imbalance_after: number
}

export interface BalancePlan {
  seed: number
  horizon_days: number
  changes: BalanceChange[]
  preview: BalancePreview
}

export interface BalanceApplyResult {
  updated: number
}
