"use client"

import { useRouter } from "next/navigation"
import { PencilIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

export type ChoresView = "today" | "week" | "edit"

/**
 * Today / Week are two views of the same checklist, so they're one joined toggle with a
 * filled selection. Edit is a different action (it opens the screen where chores,
 * to-dos and routines are changed), so it's its own accent button. Today/Week live on
 * `/chores` (Week via the `#week` hash); Edit is `/tasks`. On the checklist page pass
 * `onChange` so Today/Week swap in place without a navigation.
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
  const editing = value === "edit"
  return (
    <div className="flex items-center gap-2">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        // No segment is selected while on the Edit screen.
        value={editing ? "" : value}
        onValueChange={(v) => {
          if (!v || v === value) return
          if (onChange) onChange(v as "today" | "week")
          else router.push(`/app/family/${familyId}/chores${v === "week" ? "#week" : ""}`)
        }}
      >
        {(["today", "week"] as const).map((v) => (
          <ToggleGroupItem
            key={v}
            value={v}
            className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary data-[state=on]:hover:text-primary-foreground"
          >
            {v === "today" ? "Today" : "Week"}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Button
        size="sm"
        variant={editing ? "default" : "outline"}
        className={editing ? undefined : "border-primary/60 text-primary hover:text-primary"}
        aria-current={editing ? "page" : undefined}
        onClick={() => !editing && router.push(`/app/family/${familyId}/tasks`)}
      >
        <PencilIcon /> Edit
      </Button>
    </div>
  )
}
