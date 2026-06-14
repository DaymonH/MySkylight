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
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet"
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
import type {
  CalendarOut,
  MemberBrief,
  OccurrenceOut,
} from "@/lib/types/calendar"

const RRULE_OPTIONS = [
  { label: "Does not repeat", value: "none" },
  { label: "Every day", value: "FREQ=DAILY" },
  { label: "Every week", value: "FREQ=WEEKLY" },
  { label: "Every 2 weeks", value: "FREQ=WEEKLY;INTERVAL=2" },
  { label: "Every month", value: "FREQ=MONTHLY" },
  { label: "Every year", value: "FREQ=YEARLY" },
]

const schema = z.object({
  title: z.string().min(1, "Title is required"),
  calendar_id: z.string().min(1, "Choose a calendar"),
  start_dt: z.string().min(1),
  end_dt: z.string().min(1),
  all_day: z.boolean(),
  location: z.string().optional(),
  description: z.string().optional(),
  rrule: z.string().optional(),
  is_countdown: z.boolean(),
  member_ids: z.array(z.string()),
  reminder_minutes: z.array(z.number()),
})
type FormValues = z.infer<typeof schema>

interface EventSheetProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: FormValues) => void
  onDelete?: () => void
  isPending: boolean
  isDeleting?: boolean
  calendars: CalendarOut[]
  members: MemberBrief[]
  defaultDate?: string // YYYY-MM-DD
  editing?: OccurrenceOut
}

function isoLocal(dateStr: string, time: string) {
  return `${dateStr}T${time}:00`
}

function toDatetimeLocal(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function EventSheet({
  open,
  onClose,
  onSubmit,
  onDelete,
  isPending,
  isDeleting,
  calendars,
  members,
  defaultDate,
  editing,
}: EventSheetProps) {
  const now = new Date()
  const defaultStart = defaultDate
    ? isoLocal(defaultDate, `${String(now.getHours()).padStart(2, "0")}:00`)
    : toDatetimeLocal(
        new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          now.getHours() + 1
        ).toISOString()
      )
  const defaultEnd = defaultDate
    ? isoLocal(defaultDate, `${String(now.getHours() + 1).padStart(2, "0")}:00`)
    : toDatetimeLocal(
        new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          now.getHours() + 2
        ).toISOString()
      )

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      calendar_id: calendars[0]?.id ?? "",
      start_dt: defaultStart,
      end_dt: defaultEnd,
      all_day: false,
      rrule: "none",
      is_countdown: false,
      member_ids: [],
      reminder_minutes: [],
    },
  })

  useEffect(() => {
    if (open) {
      if (editing) {
        reset({
          title: editing.title,
          calendar_id: editing.calendar_id,
          start_dt: toDatetimeLocal(editing.start_dt),
          end_dt: toDatetimeLocal(editing.end_dt),
          all_day: editing.all_day,
          location: editing.location ?? "",
          description: editing.description ?? "",
          rrule: "none",
          is_countdown: editing.is_countdown,
          member_ids: editing.members.map((m) => m.id),
          reminder_minutes: editing.reminder_minutes,
        })
      } else {
        reset({
          title: "",
          calendar_id: calendars[0]?.id ?? "",
          start_dt: defaultStart,
          end_dt: defaultEnd,
          all_day: false,
          rrule: "none",
          is_countdown: false,
          member_ids: [],
          reminder_minutes: [],
        })
      }
    }
  }, [open, editing, defaultDate]) // eslint-disable-line react-hooks/exhaustive-deps

  const allDay = watch("all_day")

  // Map the sentinel "none" back to "" so the parent's payload logic is unchanged.
  function submit(values: FormValues) {
    onSubmit({ ...values, rrule: values.rrule === "none" ? "" : values.rrule })
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle className="text-lg">
            {editing ? "Edit event" : "New event"}
          </SheetTitle>
        </SheetHeader>

        <form
          onSubmit={handleSubmit(submit)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="thin-scrollbar flex-1 space-y-5 overflow-y-auto p-6">
            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                {...register("title")}
                placeholder="Event title"
              />
              {errors.title && (
                <p className="text-xs text-destructive">
                  {errors.title.message}
                </p>
              )}
            </div>

            {/* Calendar */}
            <div className="space-y-1.5">
              <Label>Calendar</Label>
              <Controller
                name="calendar_id"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose a calendar" />
                    </SelectTrigger>
                    <SelectContent>
                      {calendars.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <span
                            className="size-2.5 rounded-full"
                            style={{ backgroundColor: c.color }}
                          />
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.calendar_id && (
                <p className="text-xs text-destructive">
                  {errors.calendar_id.message}
                </p>
              )}
            </div>

            {/* All day */}
            <div className="flex items-center justify-between rounded-2xl bg-muted/40 px-3.5 py-2.5">
              <Label htmlFor="all_day" className="cursor-pointer">
                All day
              </Label>
              <Controller
                name="all_day"
                control={control}
                render={({ field }) => (
                  <Switch
                    id="all_day"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </div>

            {/* Times */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="start_dt">Starts</Label>
                <Input
                  id="start_dt"
                  type={allDay ? "date" : "datetime-local"}
                  {...register("start_dt")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end_dt">Ends</Label>
                <Input
                  id="end_dt"
                  type={allDay ? "date" : "datetime-local"}
                  {...register("end_dt")}
                />
              </div>
            </div>

            {/* Repeat */}
            <div className="space-y-1.5">
              <Label>Repeat</Label>
              <Controller
                name="rrule"
                control={control}
                render={({ field }) => (
                  <Select
                    value={field.value || "none"}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RRULE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            {/* Location */}
            <div className="space-y-1.5">
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                {...register("location")}
                placeholder="Add a location"
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="description">Notes</Label>
              <Textarea
                id="description"
                {...register("description")}
                placeholder="Add notes"
              />
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
                                ? {
                                    backgroundColor: m.color,
                                    borderColor: m.color,
                                    color: "#fff",
                                  }
                                : { borderColor: m.color }
                            }
                          >
                            <span
                              className="size-2 rounded-full"
                              style={{
                                backgroundColor: selected ? "#fff" : m.color,
                              }}
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

            {/* Countdown */}
            <div className="flex items-center justify-between rounded-2xl bg-muted/40 px-3.5 py-2.5">
              <div>
                <Label htmlFor="is_countdown" className="cursor-pointer">
                  Countdown
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Show a days-remaining tile up top.
                </p>
              </div>
              <Controller
                name="is_countdown"
                control={control}
                render={({ field }) => (
                  <Switch
                    id="is_countdown"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </div>
          </div>

          {/* Footer */}
          <SheetFooter className="flex-row items-center gap-2 border-t">
            {onDelete && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    aria-label="Delete event"
                  >
                    <Trash2Icon />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this event?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently removes the event for everyone in the
                      family. This can&apos;t be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isDeleting}>
                      Cancel
                    </AlertDialogCancel>
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
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={isPending}>
              {isPending
                ? "Saving…"
                : editing
                  ? "Save changes"
                  : "Create event"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
