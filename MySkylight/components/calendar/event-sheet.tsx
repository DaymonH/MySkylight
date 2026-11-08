"use client"

import { useEffect, useMemo, useState } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { CloudIcon, HouseIcon, TriangleAlertIcon, Trash2Icon } from "lucide-react"

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
  EditScope,
  EventSource,
  MemberBrief,
  OccurrenceOut,
} from "@/lib/types/calendar"
import { findConflicts } from "@/lib/event-conflicts"

const PROVIDER_LABELS: Record<NonNullable<EventSource["provider"]>, string> = {
  google: "Google",
  apple: "iCloud",
  ics: "Calendar feed",
}

// One-line provenance for an event, e.g. "Synced from Holidays · Google" or
// "Added in MySkylight" — the headline that explains why an event can appear twice.
function sourceHeadline(source: EventSource): string {
  if (source.kind === "local") return "Added in MySkylight"
  const provider = source.provider ? PROVIDER_LABELS[source.provider] : null
  return provider ? `Synced from ${source.label} · ${provider}` : `Synced from ${source.label}`
}

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
  /** `scope` is "all" for anything that isn't a repeating event being edited. */
  onSubmit: (data: FormValues, scope: EditScope) => void
  /** `scope` is "all" unless a repeating event's single occurrence was chosen. */
  onDelete?: (scope: EditScope) => void
  isPending: boolean
  isDeleting?: boolean
  members: MemberBrief[]
  defaultDate?: string // YYYY-MM-DD
  /** HH:MM start for a new event (tap-to-create on a time slot). Needs defaultDate. */
  defaultTime?: string
  editing?: OccurrenceOut
  /** Events already on the calendar (the visible range), to warn about double-booking. */
  existing?: OccurrenceOut[]
}

const SCOPE_OPTIONS: { value: EditScope; label: string; hint: string }[] = [
  { value: "this", label: "This event", hint: "Only this date" },
  { value: "following", label: "This and following events", hint: "From this date on" },
  { value: "all", label: "All events", hint: "The whole series" },
]

/** Radio-style picker for which occurrences an edit/delete applies to. */
function ScopePicker({
  value,
  onChange,
  options,
  thisDisabledReason,
}: {
  value: EditScope
  onChange: (v: EditScope) => void
  options: EditScope[]
  /** When set, "This event" can't be chosen and this explains why. */
  thisDisabledReason?: string
}) {
  return (
    <div role="radiogroup" className="flex flex-col gap-2">
      {SCOPE_OPTIONS.filter((o) => options.includes(o.value)).map((o) => {
        const disabled = o.value === "this" && !!thisDisabledReason
        return (
          <label
            key={o.value}
            className={`flex items-start gap-3 rounded-xl border p-3 text-left text-sm ${
              disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
            } ${value === o.value ? "border-primary bg-primary/5" : ""}`}
          >
            <input
              type="radio"
              name="edit-scope"
              className="mt-0.5"
              checked={value === o.value}
              disabled={disabled}
              onChange={() => onChange(o.value)}
            />
            <span>
              <span className="font-medium">{o.label}</span>
              <span className="text-muted-foreground block text-xs">
                {disabled ? thisDisabledReason : o.hint}
              </span>
            </span>
          </label>
        )
      })}
    </div>
  )
}

function isoLocal(dateStr: string, time: string) {
  return `${dateStr}T${time}:00`
}

/** `YYYY-MM-DDTHH:MM` for a local wall-clock time `minutes` after the given one. */
function plusMinutesLocal(local: string, minutes: number) {
  const d = new Date(local)
  d.setMinutes(d.getMinutes() + minutes)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function toDatetimeLocal(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Human-readable "when" for the read-only details view (external mirror events).
function formatWhen(occ: OccurrenceOut) {
  const start = new Date(occ.start_dt)
  const end = new Date(occ.end_dt)
  const dateOpts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "long",
    day: "numeric",
  }
  if (occ.all_day) {
    const sameDay = occ.start_dt.slice(0, 10) === occ.end_dt.slice(0, 10)
    return sameDay
      ? `${start.toLocaleDateString(undefined, dateOpts)} · All day`
      : `${start.toLocaleDateString(undefined, dateOpts)} – ${end.toLocaleDateString(undefined, dateOpts)}`
  }
  const timeOpts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" }
  if (start.toDateString() === end.toDateString()) {
    return `${start.toLocaleDateString(undefined, dateOpts)} · ${start.toLocaleTimeString(
      undefined,
      timeOpts,
    )} – ${end.toLocaleTimeString(undefined, timeOpts)}`
  }
  return `${start.toLocaleString(undefined, { ...dateOpts, ...timeOpts })} – ${end.toLocaleString(
    undefined,
    { ...dateOpts, ...timeOpts },
  )}`
}

export function EventSheet({
  open,
  onClose,
  onSubmit,
  onDelete,
  isPending,
  isDeleting,
  members,
  defaultDate,
  defaultTime,
  editing,
  existing = [],
}: EventSheetProps) {
  const now = new Date()
  const pad2 = (n: number) => String(n).padStart(2, "0")
  // Top of the next hour today — or the tapped date (at the tapped time, else the
  // current hour). `plusMinutesLocal` keeps the end valid across midnight (23:00 +1h).
  const nextHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1)
  const defaultStart = defaultDate
    ? isoLocal(defaultDate, defaultTime ?? `${pad2(now.getHours())}:00`)
    : plusMinutesLocal(
        `${nextHour.getFullYear()}-${pad2(nextHour.getMonth() + 1)}-${pad2(nextHour.getDate())}T${pad2(nextHour.getHours())}:00:00`,
        0,
      )
  const defaultEnd = plusMinutesLocal(defaultStart, 60)

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
  }, [open, editing, defaultDate, defaultTime]) // eslint-disable-line react-hooks/exhaustive-deps

  const allDay = watch("all_day")

  // Double-booking heads-up: anyone selected who's already on an overlapping event.
  // A warning only — families legitimately overlap (a parent covering two kids), so
  // it never blocks saving. Limited to the events loaded for the visible range.
  const [wStart, wEnd, wMembers] = watch(["start_dt", "end_dt", "member_ids"])
  const conflicts = useMemo(
    () =>
      findConflicts(existing, {
        start: new Date(wStart),
        end: new Date(wEnd),
        memberIds: wMembers ?? [],
        allDay,
        ignoreEventId: editing?.event_id,
      }),
    [existing, wStart, wEnd, wMembers, allDay, editing?.event_id],
  )

  // Editing touches a shared family event, so confirm before persisting. New
  // events submit straight away — there's nothing to clobber yet. handleSubmit
  // only calls this once the form validates, so the confirm never fires on an
  // invalid form. A repeating event's confirm also asks which occurrences to change.
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingValues, setPendingValues] = useState<FormValues | null>(null)
  const [scope, setScope] = useState<EditScope>("this")
  const [deleteScope, setDeleteScope] = useState<EditScope>("this")
  const isRecurring = !!editing?.is_recurring

  // Who's assigned, reminders, repeat, all-day and countdown belong to the whole
  // series — the backend ignores them for a single occurrence — so "This event" is
  // only offered while none of them have been changed.
  const seriesOnlyReason = (() => {
    if (!editing || !pendingValues) return undefined
    const sameSet = (a: (string | number)[], b: (string | number)[]) =>
      a.length === b.length && [...a].sort().join() === [...b].sort().join()
    const changed =
      !sameSet(pendingValues.member_ids, editing.members.map((m) => m.id)) ||
      !sameSet(pendingValues.reminder_minutes, editing.reminder_minutes) ||
      pendingValues.all_day !== editing.all_day ||
      pendingValues.is_countdown !== editing.is_countdown ||
      !!pendingValues.rrule
    return changed
      ? "You changed who's assigned, reminders or repeat — those apply to the whole series."
      : undefined
  })()

  // Map the sentinel "none" back to "" so the parent's payload logic is unchanged.
  function submit(values: FormValues) {
    const mapped = { ...values, rrule: values.rrule === "none" ? "" : values.rrule }
    if (editing) {
      setPendingValues(mapped)
      setScope("this")
      setConfirmOpen(true)
    } else {
      onSubmit(mapped, "all")
    }
  }

  function confirmSave() {
    if (pendingValues) {
      const effective: EditScope =
        isRecurring ? (scope === "this" && seriesOnlyReason ? "all" : scope) : "all"
      onSubmit(pendingValues, effective)
    }
    setConfirmOpen(false)
  }

  // External-mirror events (F18/F20) are read-only: show their details, but offer
  // no edit form, no save, and no delete — the backend rejects writes anyway.
  if (editing?.read_only) {
    return (
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle className="text-lg">Event details</SheetTitle>
          </SheetHeader>

          <div className="thin-scrollbar flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
            <div className="flex items-start gap-2 rounded-2xl bg-muted/50 px-3.5 py-2.5 text-sm text-muted-foreground">
              <CloudIcon className="mt-0.5 size-4 flex-shrink-0" />
              <div className="space-y-0.5">
                <p className="font-medium text-foreground">{sourceHeadline(editing.source)}</p>
                <p className="text-xs">
                  Read-only here — manage it in the source calendar. The same event
                  may also exist elsewhere (e.g. added in MySkylight), which is why
                  it can appear more than once.
                </p>
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Title</p>
              <p className="text-base font-medium">{editing.title}</p>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Source</p>
              <p className="text-sm">
                {editing.source.label}
                {editing.source.provider && (
                  <span className="text-muted-foreground">
                    {" · "}
                    {PROVIDER_LABELS[editing.source.provider]}
                  </span>
                )}
              </p>
              {editing.source.account_email && (
                <p className="text-xs text-muted-foreground">{editing.source.account_email}</p>
              )}
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">When</p>
              <p className="text-sm">{formatWhen(editing)}</p>
            </div>

            {editing.location && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Location</p>
                <p className="text-sm">{editing.location}</p>
              </div>
            )}

            {editing.description && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Notes</p>
                <p className="whitespace-pre-wrap text-sm">{editing.description}</p>
              </div>
            )}

            {editing.members.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Assigned to</p>
                <div className="flex flex-wrap gap-1.5">
                  {editing.members.map((m) => (
                    <span
                      key={m.id}
                      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
                      style={{ borderColor: m.color }}
                    >
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: m.color }}
                      />
                      {m.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <SheetFooter className="border-t">
            <Button type="button" variant="outline" className="w-full" onClick={onClose}>
              Close
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    )
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
            {/* Source — only when editing an existing (already-saved) event, so a
                duplicate can be told apart from its synced twin. */}
            {editing && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <HouseIcon className="size-3.5 flex-shrink-0" />
                <span>{sourceHeadline(editing.source)}</span>
              </div>
            )}

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

            {conflicts.length > 0 && (
              <div
                role="status"
                className="flex items-start gap-2 rounded-2xl border border-amber-300/60 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
              >
                <TriangleAlertIcon className="mt-0.5 size-4 flex-shrink-0" />
                <div className="space-y-0.5">
                  <p className="font-medium">Possible double-booking</p>
                  {conflicts.slice(0, 3).map((c) => (
                    <p key={`${c.member.id}:${c.occurrence.event_id}:${c.occurrence.occurrence_date}`} className="text-xs">
                      {c.member.name} is already on &ldquo;{c.occurrence.title}&rdquo;{" "}
                      {new Date(c.occurrence.start_dt).toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      &ndash;
                      {new Date(c.occurrence.end_dt).toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  ))}
                  {conflicts.length > 3 && (
                    <p className="text-xs">+{conflicts.length - 3} more</p>
                  )}
                </div>
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
                    <AlertDialogTitle>
                      {isRecurring ? "Delete repeating event" : "Delete this event?"}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {isRecurring
                        ? "Choose what to remove for everyone in the family."
                        : "This permanently removes the event for everyone in the family. This can\u2019t be undone."}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  {isRecurring && (
                    <ScopePicker
                      value={deleteScope}
                      onChange={setDeleteScope}
                      options={["this", "all"]}
                    />
                  )}
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isDeleting}>
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={() => onDelete(isRecurring ? deleteScope : "all")}
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

        {/* Confirm before saving edits to an existing (shared) event. */}
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {isRecurring ? "Edit repeating event" : "Save changes to this event?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {isRecurring
                  ? "Choose which events to change. This updates them for everyone in the family."
                  : "This updates the event for everyone in the family."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {isRecurring && (
              <ScopePicker
                value={scope === "this" && seriesOnlyReason ? "all" : scope}
                onChange={setScope}
                options={["this", "following", "all"]}
                thisDisabledReason={seriesOnlyReason}
              />
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={confirmSave} disabled={isPending}>
                {isPending ? "Saving…" : "Save changes"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  )
}
