import type { MemberBrief } from "@/lib/types/calendar"

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
  created_at: string
  updated_at: string
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

/** A single dated instance of a task with its per-member completion state. */
export interface TaskOccurrenceOut {
  task_id: string
  routine_id: string | null
  title: string
  description: string | null
  occurrence_date: string // YYYY-MM-DD
  effective_color: string
  is_recurring: boolean
  members: MemberBrief[]
  completed_member_ids: string[]
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
  member_ids?: string[]
}

export type TaskUpdatePayload = Partial<TaskCreatePayload>

export interface RoutineCreatePayload {
  name: string
  sort_order?: number
}

export type RoutineUpdatePayload = Partial<RoutineCreatePayload>
