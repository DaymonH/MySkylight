import type { MemberBrief } from "@/lib/types/calendar"

export type AssignmentStrategy = "fixed" | "rotating"

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
  star_value: number
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
  members: MemberBrief[]
  completed_member_ids: string[]
  up_next: MemberBrief | null
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
  star_value?: number
  // Order is the rotation roster order when rotating.
  member_ids?: string[]
}

export type TaskUpdatePayload = Partial<TaskCreatePayload>

export interface RoutineCreatePayload {
  name: string
  sort_order?: number
}

export type RoutineUpdatePayload = Partial<RoutineCreatePayload>
