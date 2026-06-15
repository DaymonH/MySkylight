"use client"

import { useEffect } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
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
      })
    } else {
      reset({
        title: "",
        description: "",
        routine_id: defaultRoutineId ?? NO_ROUTINE,
        start_date: todayYMD(),
        rrule: "none",
        member_ids: [],
      })
    }
  }, [open, editing, defaultRoutineId]) // eslint-disable-line react-hooks/exhaustive-deps

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
                  render={({ field }) => (
                    <ToggleGroup
                      type="multiple"
                      variant="outline"
                      value={field.value}
                      onValueChange={field.onChange}
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
                  )}
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
