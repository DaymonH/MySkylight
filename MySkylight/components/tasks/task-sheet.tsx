"use client"

import { useEffect } from "react"
import { useForm, useWatch, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { ChevronDownIcon, ChevronUpIcon, Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  bydayRrule,
  CUSTOM_WEEKLY,
  parseByday,
  TASK_RRULE_OPTIONS,
  WEEKDAYS,
  weekdayOf,
  type WeekdayCode,
} from "@/lib/recurrence"
import type { MemberBrief } from "@/lib/types/calendar"
import type { RoutineOut, TaskOut } from "@/lib/types/task"

export const NO_ROUTINE = "none"

const schema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().optional(),
  routine_id: z.string(),
  start_date: z.string().min(1, "Pick a start date"),
  rrule: z.string(),
  star_value: z.number().int().min(0).max(999),
  member_ids: z.array(z.string()),
  rotate: z.boolean(),
  rotation_unit: z.enum(["occurrence", "day", "week", "month"]),
  rotation_interval: z.number().int().min(1).max(52),
})
export type TaskFormValues = z.infer<typeof schema>

interface TaskSheetProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: TaskFormValues) => void
  onDelete?: () => void
  isPending: boolean
  isDeleting?: boolean
  routines: RoutineOut[]
  members: MemberBrief[]
  defaultRoutineId?: string
  editing?: TaskOut
}

function todayYMD() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`
}

export function TaskSheet({
  open,
  onClose,
  onSubmit,
  onDelete,
  isPending,
  isDeleting,
  routines,
  members,
  defaultRoutineId,
  editing,
}: TaskSheetProps) {
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<TaskFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      description: "",
      routine_id: defaultRoutineId ?? NO_ROUTINE,
      start_date: todayYMD(),
      rrule: "none",
      star_value: 1,
      member_ids: [],
      rotate: false,
      rotation_unit: "occurrence",
      rotation_interval: 1,
    },
  })

  useEffect(() => {
    if (!open) return
    if (editing) {
      reset({
        title: editing.title,
        description: editing.description ?? "",
        routine_id: editing.routine_id ?? NO_ROUTINE,
        start_date: editing.start_date,
        rrule: editing.rrule ?? "none",
        star_value: editing.star_value,
        member_ids: editing.members.map((m) => m.id),
        rotate: editing.assignment_strategy === "rotating",
        rotation_unit: editing.rotation_unit ?? "occurrence",
        rotation_interval: editing.rotation_interval ?? 1,
      })
    } else {
      reset({
        title: "",
        description: "",
        routine_id: defaultRoutineId ?? NO_ROUTINE,
        start_date: todayYMD(),
        rrule: "none",
        star_value: 1,
        member_ids: [],
        rotate: false,
        rotation_unit: "occurrence",
        rotation_interval: 1,
      })
    }
  }, [open, editing, defaultRoutineId]) // eslint-disable-line react-hooks/exhaustive-deps

  const rotate = useWatch({ control, name: "rotate" })
  const rotationInterval = useWatch({ control, name: "rotation_interval" })
  const startDate = useWatch({ control, name: "start_date" })
  // The Repeat select shows "Custom days…" for any weekly BYDAY rrule that isn't a
  // named preset (e.g. FREQ=WEEKLY;BYDAY=TU,SA). The form field still holds the real
  // rrule string — this just decides which select item is highlighted.
  const selectRepeatValue = (rrule: string): string => {
    if (TASK_RRULE_OPTIONS.some((o) => o.value === rrule)) return rrule
    if (rrule.includes("FREQ=WEEKLY") && rrule.includes("BYDAY=")) return CUSTOM_WEEKLY
    return rrule || "none"
  }
  const unitLabel = (unit: "occurrence" | "day" | "week" | "month") => {
    const plural = rotationInterval !== 1
    if (unit === "occurrence") return plural ? "times it's due" : "time it's due"
    return plural ? `${unit}s` : unit
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle className="text-lg">{editing ? "Edit task" : "New task"}</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
          <div className="thin-scrollbar flex-1 space-y-5 overflow-y-auto p-6">
            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="task-title">Title</Label>
              <Input id="task-title" {...register("title")} placeholder="e.g. Make bed" />
              {errors.title && <p className="text-destructive text-xs">{errors.title.message}</p>}
            </div>

            {/* Routine */}
            <div className="space-y-1.5">
              <Label>Routine</Label>
              <Controller
                name="routine_id"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_ROUTINE}>No routine</SelectItem>
                      {routines.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            {/* Start date */}
            <div className="space-y-1.5">
              <Label htmlFor="task-start">Starts</Label>
              <Input id="task-start" type="date" {...register("start_date")} />
              {errors.start_date && (
                <p className="text-destructive text-xs">{errors.start_date.message}</p>
              )}
            </div>

            {/* Repeat */}
            <div className="space-y-1.5">
              <Label>Repeat</Label>
              <Controller
                name="rrule"
                control={control}
                render={({ field }) => {
                  const selectValue = selectRepeatValue(field.value)
                  const onRepeatChange = (val: string) => {
                    if (val === CUSTOM_WEEKLY) {
                      // Entering custom mode: keep any existing day-set, else seed
                      // with the start date's weekday so it's never an empty rule.
                      const existing = parseByday(field.value)
                      const seed = startDate ? weekdayOf(startDate) : "MO"
                      field.onChange(bydayRrule(existing.length ? existing : [seed]))
                    } else {
                      field.onChange(val)
                    }
                  }
                  const days = parseByday(field.value)
                  const onToggleDays = (next: string[]) => {
                    if (next.length === 0) return // keep at least one day selected
                    field.onChange(bydayRrule(next as WeekdayCode[]))
                  }
                  return (
                    <>
                      <Select value={selectValue} onValueChange={onRepeatChange}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TASK_RRULE_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                          <SelectItem value={CUSTOM_WEEKLY}>Custom days…</SelectItem>
                        </SelectContent>
                      </Select>

                      {selectValue === CUSTOM_WEEKLY && (
                        <ToggleGroup
                          type="multiple"
                          variant="outline"
                          value={days}
                          onValueChange={onToggleDays}
                          className="flex flex-wrap justify-start pt-1"
                        >
                          {WEEKDAYS.map((d) => (
                            <ToggleGroupItem
                              key={d.code}
                              value={d.code}
                              aria-label={d.label}
                              className="w-12 rounded-full"
                            >
                              {d.label}
                            </ToggleGroupItem>
                          ))}
                        </ToggleGroup>
                      )}
                    </>
                  )
                }}
              />
            </div>

            {/* Stars (F14 rewards) */}
            <div className="space-y-1.5">
              <Label htmlFor="task-stars">Stars for completing ⭐</Label>
              <Input
                id="task-stars"
                type="number"
                min={0}
                max={999}
                {...register("star_value", { valueAsNumber: true })}
              />
              <p className="text-muted-foreground text-xs">
                Stars the member earns each time they check this off. Set 0 for no reward.
              </p>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label htmlFor="task-notes">Notes</Label>
              <Textarea id="task-notes" {...register("description")} placeholder="Add notes" />
            </div>

            {/* Members */}
            {members.length > 0 && (
              <div className="space-y-2">
                <Label>Assign to</Label>
                <Controller
                  name="member_ids"
                  control={control}
                  render={({ field }) => {
                    // Preserve rotation order: keep existing ids in place, append new
                    // selections to the end. (Radix toggle-group reports DOM order.)
                    const onToggle = (next: string[]) => {
                      const kept = field.value.filter((id) => next.includes(id))
                      const added = next.filter((id) => !field.value.includes(id))
                      field.onChange([...kept, ...added])
                    }
                    const move = (idx: number, dir: -1 | 1) => {
                      const arr = [...field.value]
                      const j = idx + dir
                      if (j < 0 || j >= arr.length) return
                      ;[arr[idx], arr[j]] = [arr[j], arr[idx]]
                      field.onChange(arr)
                    }
                    return (
                      <>
                        <ToggleGroup
                          type="multiple"
                          variant="outline"
                          value={field.value}
                          onValueChange={onToggle}
                          className="flex flex-wrap justify-start"
                        >
                          {members.map((m) => {
                            const selected = field.value.includes(m.id)
                            return (
                              <ToggleGroupItem
                                key={m.id}
                                value={m.id}
                                className="gap-1.5 rounded-full"
                                style={
                                  selected
                                    ? { backgroundColor: m.color, borderColor: m.color, color: "#fff" }
                                    : { borderColor: m.color }
                                }
                              >
                                <span
                                  className="size-2 rounded-full"
                                  style={{ backgroundColor: selected ? "#fff" : m.color }}
                                />
                                {m.name}
                              </ToggleGroupItem>
                            )
                          })}
                        </ToggleGroup>

                        {/* Rotation (F27) */}
                        <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">Rotate between members</p>
                            <p className="text-muted-foreground text-xs">
                              Hands off to the next person on the cadence you choose below.
                            </p>
                          </div>
                          <Controller
                            name="rotate"
                            control={control}
                            render={({ field: rf }) => (
                              <Switch
                                checked={rf.value}
                                onCheckedChange={rf.onChange}
                                disabled={field.value.length < 2}
                                aria-label="Rotate between members"
                              />
                            )}
                          />
                        </div>

                        {rotate && field.value.length >= 2 && (
                          <div className="space-y-1.5">
                            {/* Rotation cadence — decoupled from how often the chore repeats. */}
                            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                              Rotation cadence
                            </p>
                            <div className="flex items-center gap-2">
                              <span className="text-sm whitespace-nowrap">Rotate every</span>
                              <Input
                                type="number"
                                min={1}
                                max={52}
                                className="w-16"
                                aria-label="Rotation interval"
                                {...register("rotation_interval", { valueAsNumber: true })}
                              />
                              <Controller
                                name="rotation_unit"
                                control={control}
                                render={({ field: uf }) => (
                                  <Select value={uf.value} onValueChange={uf.onChange}>
                                    <SelectTrigger className="flex-1">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="occurrence">{unitLabel("occurrence")}</SelectItem>
                                      <SelectItem value="day">{unitLabel("day")}</SelectItem>
                                      <SelectItem value="week">{unitLabel("week")}</SelectItem>
                                      <SelectItem value="month">{unitLabel("month")}</SelectItem>
                                    </SelectContent>
                                  </Select>
                                )}
                              />
                            </div>
                            <p className="text-muted-foreground text-xs">
                              How often the chore passes to the next person — independent of how often
                              it repeats. Weeks change on Monday, months on the 1st.
                            </p>

                            <p className="text-muted-foreground pt-1 text-xs font-medium uppercase tracking-wide">
                              Rotation order
                            </p>
                            <ul className="flex flex-col gap-1.5">
                              {field.value.map((id, idx) => {
                                const m = members.find((mm) => mm.id === id)
                                if (!m) return null
                                return (
                                  <li
                                    key={id}
                                    className="flex items-center gap-2 rounded-xl border px-3 py-2"
                                  >
                                    <span className="text-muted-foreground w-4 text-sm tabular-nums">
                                      {idx + 1}
                                    </span>
                                    <span
                                      className="size-2.5 rounded-full"
                                      style={{ backgroundColor: m.color }}
                                    />
                                    <span className="flex-1 truncate text-sm">{m.name}</span>
                                    <Button
                                      type="button"
                                      size="icon-sm"
                                      variant="ghost"
                                      disabled={idx === 0}
                                      onClick={() => move(idx, -1)}
                                      aria-label={`Move ${m.name} up`}
                                    >
                                      <ChevronUpIcon />
                                    </Button>
                                    <Button
                                      type="button"
                                      size="icon-sm"
                                      variant="ghost"
                                      disabled={idx === field.value.length - 1}
                                      onClick={() => move(idx, 1)}
                                      aria-label={`Move ${m.name} down`}
                                    >
                                      <ChevronDownIcon />
                                    </Button>
                                  </li>
                                )
                              })}
                            </ul>
                          </div>
                        )}
                      </>
                    )
                  }}
                />
              </div>
            )}
          </div>

          {/* Footer */}
          <SheetFooter className="flex-row items-center gap-2 border-t">
            {onDelete && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="destructive" size="icon" aria-label="Delete task">
                    <Trash2Icon />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this task?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently removes the task and its completion history for everyone in the
                      family. This can&apos;t be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={onDelete}
                      disabled={isDeleting}
                    >
                      {isDeleting ? "Deleting…" : "Delete"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={isPending}>
              {isPending ? "Saving…" : editing ? "Save changes" : "Create task"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
