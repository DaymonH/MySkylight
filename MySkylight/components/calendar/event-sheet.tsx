"use client"

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import type { CalendarOut, MemberBrief, OccurrenceOut } from "@/lib/types/calendar"

const RRULE_OPTIONS = [
  { label: "Does not repeat", value: "" },
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
  isPending: boolean
  calendars: CalendarOut[]
  members: MemberBrief[]
  defaultDate?: string   // YYYY-MM-DD
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
  open, onClose, onSubmit, isPending, calendars, members, defaultDate, editing,
}: EventSheetProps) {
  const now = new Date()
  const defaultStart = defaultDate
    ? isoLocal(defaultDate, `${String(now.getHours()).padStart(2, "0")}:00`)
    : toDatetimeLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1).toISOString())
  const defaultEnd = defaultDate
    ? isoLocal(defaultDate, `${String(now.getHours() + 1).padStart(2, "0")}:00`)
    : toDatetimeLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 2).toISOString())

  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      calendar_id: calendars[0]?.id ?? "",
      start_dt: defaultStart,
      end_dt: defaultEnd,
      all_day: false,
      rrule: "",
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
          rrule: "",
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
          rrule: "",
          is_countdown: false,
          member_ids: [],
          reminder_minutes: [],
        })
      }
    }
  }, [open, editing, defaultDate]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedMemberIds = watch("member_ids")

  function toggleMember(id: string) {
    setValue(
      "member_ids",
      selectedMemberIds.includes(id)
        ? selectedMemberIds.filter((m) => m !== id)
        : [...selectedMemberIds, id],
    )
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
      <div className="bg-background w-full max-w-lg rounded-t-2xl p-4 shadow-xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{editing ? "Edit Event" : "New Event"}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">✕</button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3 overflow-y-auto max-h-[70vh]">
          {/* Title */}
          <input
            {...register("title")}
            placeholder="Event title"
            className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
          {errors.title && <p className="text-destructive -mt-2 text-xs">{errors.title.message}</p>}

          {/* Calendar */}
          <select
            {...register("calendar_id")}
            className="border-input bg-background rounded-lg border px-3 py-2 text-sm"
          >
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          {/* Times */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Start</label>
              <input
                type="datetime-local"
                {...register("start_dt")}
                className="border-input bg-background w-full rounded-lg border px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">End</label>
              <input
                type="datetime-local"
                {...register("end_dt")}
                className="border-input bg-background w-full rounded-lg border px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          {/* All-day + Countdown row */}
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" {...register("all_day")} className="h-4 w-4" />
              All day
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" {...register("is_countdown")} className="h-4 w-4" />
              Countdown
            </label>
          </div>

          {/* Recurrence */}
          <select
            {...register("rrule")}
            className="border-input bg-background rounded-lg border px-3 py-2 text-sm"
          >
            {RRULE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          {/* Location */}
          <input
            {...register("location")}
            placeholder="Location (optional)"
            className="border-input bg-background rounded-lg border px-3 py-2 text-sm"
          />

          {/* Members */}
          {members.length > 0 && (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Assign members</p>
              <div className="flex flex-wrap gap-2">
                {members.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleMember(m.id)}
                    className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm transition-colors"
                    style={{
                      backgroundColor: selectedMemberIds.includes(m.id) ? m.color : "transparent",
                      borderColor: m.color,
                      color: selectedMemberIds.includes(m.id) ? "#fff" : "inherit",
                    }}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={isPending}>
              {isPending ? "Saving…" : editing ? "Update" : "Create"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
