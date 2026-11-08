import type { MemberBrief } from "@/lib/types/calendar"

export type AssignmentStrategy = "fixed" | "rotating"

// Cadence the rotating assignee advances on, decoupled from recurrence (F27).
// "occurrence" steps every Nth occurrence (legacy behaviour); the time units step
// on calendar boundaries (weeks on Monday, months on the 1st).
export type RotationUnit = "occurrence" | "day" | "week" | "month"

export interface TaskOut {
  id: string
  family_id: string
  routine_id: string | null
  title: string
  description: string | null
  color: string | null
  start_date: string // YYYY-MM-DD
  rrule: string | null
  sort_order: number
  assignment_strategy: AssignmentStrategy
  rotation_unit: RotationUnit
  rotation_interval: number
  rotation_anchor_date: string | null // YYYY-MM-DD; null falls back to start_date
  star_value: number
  estimated_minutes: number | null // rough time-to-do (F30); weight for the balancer
  icon: string | null // optional emoji shown beside the chore
  day_pinned: boolean // true when the user picked the weekday(s); false = the app chose
  created_at: string
  updated_at: string
  // The full roster, in rotation order (matters when rotating).
  members: MemberBrief[]
}

export interface RoutineOut {
  id: string
  family_id: string
  name: string
  sort_order: number
  created_at: string
  updated_at: string
  tasks: TaskOut[]
}

/** A single dated instance of a task with its per-member completion state.
 * For a rotating task, `members` is the single resolved assignee for this date and
 * `up_next` is who gets it next occurrence; for fixed tasks `up_next` is null. */
export interface TaskOccurrenceOut {
  task_id: string
  routine_id: string | null
  title: string
  description: string | null
  occurrence_date: string // YYYY-MM-DD
  effective_color: string
  is_recurring: boolean
  star_value: number
  rotation_unit: RotationUnit
  rotation_interval: number
  members: MemberBrief[]
  completed_member_ids: string[]
  up_next: MemberBrief | null
  // Rotation override state (F27 swap/skip): `is_overridden` = a manual reassignment
  // is in effect; `is_skipped` = excused this occurrence (no one assigned).
  is_overridden: boolean
  is_skipped: boolean
  // Dismissed by "Clear missed": excused from the Missed list. Not a completion —
  // it earned no stars.
  is_dismissed: boolean
  // The chore's emoji, if it has one.
  icon: string | null
  // "Do it tomorrow": this occurrence was pushed here from `moved_from` (YYYY-MM-DD).
  is_moved: boolean
  moved_from: string | null
}

/** Result of `PUT /families/{id}/missed-chores`. `previous_cleared_through` is what
 *  the Undo toast sends back to restore. */
export interface MissedClearOut {
  missed_cleared_through: string | null
  previous_cleared_through: string | null
}

export type RotationOverrideScope = "occurrence" | "turn"

export interface RotationOverrideOut {
  task_id: string
  occurrence_date: string // YYYY-MM-DD
  member_id: string | null // null = skip (no one assigned)
}

export interface StreakOut {
  task_id: string
  member_id: string
  current_streak: number
  longest_streak: number
}

export interface TaskCreatePayload {
  routine_id?: string | null
  title: string
  // Nullable fields accept `null` to clear them on update (the backend treats an
  // explicit null as "unset this column").
  description?: string | null
  color?: string | null
  start_date?: string // YYYY-MM-DD
  rrule?: string | null
  sort_order?: number
  assignment_strategy?: AssignmentStrategy
  rotation_unit?: RotationUnit
  rotation_interval?: number
  rotation_anchor_date?: string | null
  star_value?: number
  estimated_minutes?: number | null
  icon?: string | null
  day_pinned?: boolean
  // Order is the rotation roster order when rotating.
  member_ids?: string[]
}

export type TaskUpdatePayload = Partial<TaskCreatePayload>

export interface RoutineCreatePayload {
  name: string
  sort_order?: number
}

export type RoutineUpdatePayload = Partial<RoutineCreatePayload>

/** Result of `PUT /families/{id}/tasks/{task}/occurrences/{date}/move`. */
export interface OccurrenceMoveOut {
  task_id: string
  from_date: string
  to_date: string
}
