"use client"

import { useRouter } from "next/navigation"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

export type ChoresView = "today" | "week" | "edit"

/**
 * One switch for everything chores: the Today / Week checklists and the Edit screen
 * where chores, to-dos and routines are added and changed. Today/Week live on
 * `/chores` (Week via the `#week` hash); Edit is `/tasks`. On the checklist page
 * pass `onChange` so Today/Week swap in place without a navigation.
 */
export function ChoresViewSwitch({
  familyId,
  value,
  onChange,
}: {
  familyId: string
  value: ChoresView
  onChange?: (v: "today" | "week") => void
}) {
  const router = useRouter()
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={value}
      onValueChange={(v) => {
        if (!v || v === value) return
        if (v === "edit") router.push(`/app/family/${familyId}/tasks`)
        else if (onChange) onChange(v as "today" | "week")
        else router.push(`/app/family/${familyId}/chores${v === "week" ? "#week" : ""}`)
      }}
    >
      <ToggleGroupItem value="today">Today</ToggleGroupItem>
      <ToggleGroupItem value="week">Week</ToggleGroupItem>
      <ToggleGroupItem value="edit">Edit</ToggleGroupItem>
    </ToggleGroup>
  )
}
