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
import { TASK_RRULE_OPTIONS } from "@/lib/recurrence"
import type { MemberBrief } from "@/lib/types/calendar"
import type { RoutineOut, TaskOut } from "@/lib/types/task"

export const NO_ROUTINE = "none"

const schema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().optional(),
  routine_id: z.string(),
  start_date: z.string().min(1, "Pick a start date"),
  rrule: z.string(),
  member_ids: z.array(z.string()),
  rotate: z.boolean(),
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
      member_ids: [],
      rotate: false,
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
        member_ids: editing.members.map((m) => m.id),
        rotate: editing.assignment_strategy === "rotating",
      })
    } else {
      reset({
        title: "",
        description: "",
        routine_id: defaultRoutineId ?? NO_ROUTINE,
        start_date: todayYMD(),
        rrule: "none",
        member_ids: [],
        rotate: false,
      })
    }
  }, [open, editing, defaultRoutineId]) // eslint-disable-line react-hooks/exhaustive-deps

  const rotate = useWatch({ control, name: "rotate" })

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
                render={({ field }) => (
                  <Select value={field.value || "none"} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TASK_RRULE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
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
                              Each time the chore repeats, it moves to the next person in order.
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
                            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
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
