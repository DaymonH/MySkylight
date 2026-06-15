import type { MemberBrief } from "@/lib/types/calendar"

export type ListType = "todo" | "grocery"

export interface ListItemOut {
  id: string
  list_id: string
  text: string
  quantity: string | null
  category: string | null
  is_checked: boolean
  checked_at: string | null
  sort_order: number
  assignee: MemberBrief | null
  created_at: string
  updated_at: string
}

export interface ListOut {
  id: string
  family_id: string
  name: string
  list_type: ListType
  sort_order: number
  created_at: string
  updated_at: string
  items: ListItemOut[]
}

export interface ListCreatePayload {
  name: string
  list_type?: ListType
  sort_order?: number
}

export type ListUpdatePayload = Partial<ListCreatePayload>

export interface ListItemCreatePayload {
  text: string
  // Nullable fields accept `null` to clear them on update (the backend treats an
  // explicit null as "unset this column").
  quantity?: string | null
  category?: string | null
  assignee_member_id?: string | null
  sort_order?: number
}

export type ListItemUpdatePayload = Partial<ListItemCreatePayload> & { is_checked?: boolean }
