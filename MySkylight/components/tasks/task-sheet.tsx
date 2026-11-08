"use client"

import { useEffect, useState } from "react"
import { useForm, useWatch, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
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
  CUSTOM_INTERVAL,
  formatTaskDate,
  intervalRrule,
  isCustomInterval,
  isPhaseAuto,
  isPinnedWeekly,
  parseByday,
  parseInterval,
  parseUntil,
  stripByday,
  stripUntil,
  TASK_RRULE_OPTIONS,
  WEEKDAYS,
  type IntervalUnit,
  type WeekdayCode,
} from "@/lib/recurrence"
import { TimeWheel, TIME_BUCKETS, UNSET_BUCKET } from "@/components/tasks/time-wheel"
import { IconPicker } from "@/components/tasks/icon-picker"
import { MEMBER_COLORS } from "@/lib/colors"
import { cn } from "@/lib/utils"
import type { MemberBrief } from "@/lib/types/calendar"
import type { RoutineOut, TaskOut } from "@/lib/types/task"

export const NO_ROUTINE = "none"

const schema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  icon: z.string().max(32),
  description: z.string().optional(),
  routine_id: z.string(),
  // null = inherit the assignee's / default color (no explicit chore color).
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
  // One-off: the due date. Recurring: the "Not before" date (used only when
  // `starts_immediately` is off). The weekday of a recurring chore is never taken
  // from it — the app picks that (or the user pins it with "Custom days…").
  start_date: z.string(),
  starts_immediately: z.boolean(),
  // Every-N-days / monthly: true = the user picked the starting date; false = Auto.
  start_pinned: z.boolean(),
  // The recurrence *pattern* only (FREQ/INTERVAL/BYDAY); the end date lives in
  // `end_date` and is spliced in as UNTIL when saving.
  rrule: z.string(),
  end_date: z.string(), // YYYY-MM-DD, or "" for "repeats forever"
  star_value: z.number().int().min(0).max(999),
  // Rough time-to-do in minutes; 0 means "no estimate" (sent as null).
  estimated_minutes: z.number().int().min(0).max(1440),
  member_ids: z.array(z.string()),
  rotate: z.boolean(),
  rotation_unit: z.enum(["occurrence", "day", "week", "month"]),
  rotation_interval: z.number().int().min(1).max(52),
  // Empty = anchor the rotation at the start date.
  rotation_anchor_date: z.string(),
})
  .superRefine((v, ctx) => {
    const oneOff = !v.rrule || v.rrule === "none"
    // A one-off needs a date; a recurring chore needs one only when it isn't
    // starting right away.
    const pinnedStart = !oneOff && isPhaseAuto(v.rrule) && v.start_pinned
    if ((oneOff || pinnedStart || !v.starts_immediately) && !v.start_date) {
      ctx.addIssue({
        code: "custom",
        path: ["start_date"],
        message: oneOff ? "Pick a due date" : "Pick a date",
      })
    }
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

// Which Repeat select item an rrule maps to. Pinned weekdays (BYDAY) are a separate
// "Day" control, so the cadence is read with them stripped.
const selectRepeatValue = (rrule: string): string => {
  const base = stripByday(rrule)
  if (TASK_RRULE_OPTIONS.some((o) => o.value === base && !o.value.includes("BYDAY"))) return base
  if (isCustomInterval(base)) return CUSTOM_INTERVAL
  return base || "none"
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
    setValue,
    formState: { errors },
  } = useForm<TaskFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      icon: "",
      description: "",
      routine_id: defaultRoutineId ?? NO_ROUTINE,
      color: null,
      start_date: todayYMD(),
      starts_immediately: true,
      start_pinned: false,
      rrule: "none",
      end_date: "",
      star_value: 1,
      estimated_minutes: 0,
      member_ids: [],
      rotate: false,
      rotation_unit: "occurrence",
      rotation_interval: 1,
      rotation_anchor_date: "",
    },
  })

  // Whether the Repeat picker is in "Custom days…" mode. Tracked explicitly (not
  // derived from the rrule) so the picker stays open even when the chosen day-set
  // happens to equal a preset value (e.g. Mon–Fri === the Weekdays preset).
  // "Every N days/weeks/months…" mode + its number box (a string so it can go
  // briefly empty while the user retypes; normalised on blur) and chosen unit.
  const [customIntervalMode, setCustomIntervalMode] = useState(false)
  const [intervalEvery, setIntervalEvery] = useState("2")
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>("day")

  useEffect(() => {
    if (!open) return
    if (editing) {
      // Split the stored rule into its pattern (for the Select + custom controls)
      // and its end date (the separate "Ends" control).
      const stored = editing.rrule ?? ""
      let pattern = stored ? stripUntil(stored) || "none" : "none"
      // A weekly chore the app placed on a day shows as plain "Every week" (Auto);
      // only a user-chosen day-set shows under "Custom days…".
      if (!editing.day_pinned && /FREQ=WEEKLY/i.test(pattern) && parseByday(pattern).length === 1) {
        pattern = stripByday(pattern)
      }
      const iv = parseInterval(pattern)
      const repeatVal = selectRepeatValue(pattern)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset picker mode alongside the form reset
      setCustomIntervalMode(repeatVal === CUSTOM_INTERVAL)
      setIntervalEvery(String(iv && iv.n >= 2 ? iv.n : 2))
      setIntervalUnit(iv?.unit ?? "day")
      reset({
        title: editing.title,
        icon: editing.icon ?? "",
        description: editing.description ?? "",
        routine_id: editing.routine_id ?? NO_ROUTINE,
        color: editing.color ?? null,
        start_date: editing.start_date,
        starts_immediately: true,
        start_pinned: editing.day_pinned && isPhaseAuto(pattern),
        rrule: pattern,
        end_date: parseUntil(stored) ?? "",
        star_value: editing.star_value,
        estimated_minutes: editing.estimated_minutes ?? 0,
        member_ids: editing.members.map((m) => m.id),
        rotate: editing.assignment_strategy === "rotating",
        rotation_unit: editing.rotation_unit ?? "occurrence",
        rotation_interval: editing.rotation_interval ?? 1,
        rotation_anchor_date: editing.rotation_anchor_date ?? "",
      })
    } else {
      setCustomIntervalMode(false)
      setIntervalEvery("2")
      setIntervalUnit("day")
      reset({
        title: "",
        icon: "",
        description: "",
        routine_id: defaultRoutineId ?? NO_ROUTINE,
        color: null,
        start_date: todayYMD(),
        starts_immediately: true,
        start_pinned: false,
        rrule: "none",
        end_date: "",
        star_value: 1,
        estimated_minutes: 0,
        member_ids: [],
        rotate: false,
        rotation_unit: "occurrence",
        rotation_interval: 1,
        rotation_anchor_date: "",
      })
    }
  }, [open, editing, defaultRoutineId]) // eslint-disable-line react-hooks/exhaustive-deps

  const rotate = useWatch({ control, name: "rotate" })
  const rotationInterval = useWatch({ control, name: "rotation_interval" })
  const rotationUnit = useWatch({ control, name: "rotation_unit" })
  const startDate = useWatch({ control, name: "start_date" })
  const startsImmediately = useWatch({ control, name: "starts_immediately" })
  const startPinned = useWatch({ control, name: "start_pinned" })
  const rrulePattern = useWatch({ control, name: "rrule" })
  const isRecurring = !!rrulePattern && rrulePattern !== "none"
  // Plain weekly / every-N-weeks: the app picks the weekday.
  const isAutoWeekly = /FREQ=WEEKLY/i.test(rrulePattern ?? "") && !isPinnedWeekly(rrulePattern)
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

            {/* Icon */}
            <div className="space-y-1.5">
              <Label>Icon</Label>
              <Controller
                name="icon"
                control={control}
                render={({ field }) => (
                  <IconPicker value={field.value ?? ""} onChange={field.onChange} />
                )}
              />
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

            {/* Color */}
            <div className="space-y-2">
              <Label>Color</Label>
              <Controller
                name="color"
                control={control}
                render={({ field }) => (
                  <div className="flex flex-wrap items-center gap-2">
                    {/* "Auto" inherits the assigned member's color (or the default). */}
                    <button
                      type="button"
                      aria-label="Automatic color"
                      aria-pressed={field.value == null}
                      onClick={() => field.onChange(null)}
                      className={cn(
                        "text-muted-foreground flex size-9 items-center justify-center rounded-full border text-[10px] font-medium transition-transform hover:scale-110",
                        field.value == null && "ring-foreground ring-offset-background ring-2 ring-offset-2",
                      )}
                    >
                      Auto
                    </button>
                    {MEMBER_COLORS.map((c) => {
                      const selected = field.value?.toLowerCase() === c.toLowerCase()
                      return (
                        <button
                          key={c}
                          type="button"
                          aria-label={`Color ${c}`}
                          aria-pressed={selected}
                          onClick={() => field.onChange(c)}
                          className={cn(
                            "flex size-9 items-center justify-center rounded-full transition-transform hover:scale-110",
                            selected && "ring-foreground ring-offset-background ring-2 ring-offset-2",
                          )}
                          style={{ backgroundColor: c }}
                        >
                          {selected && <CheckIcon className="size-4 text-white" />}
                        </button>
                      )
                    })}
                  </div>
                )}
              />
              <p className="text-muted-foreground text-xs">
                &ldquo;Auto&rdquo; uses the assigned member&apos;s color.
              </p>
            </div>

            {/* One-off: due date. Recurring (new): start now, or not before a date. */}
            {!isRecurring && (
              <div className="space-y-1.5">
                <Label htmlFor="task-start">Due</Label>
                <Input id="task-start" type="date" {...register("start_date")} />
                {errors.start_date && (
                  <p className="text-destructive text-xs">{errors.start_date.message}</p>
                )}
              </div>
            )}
            {isRecurring && !editing && !(isPhaseAuto(rrulePattern) && startPinned) && (
              <div className="space-y-2">
                <Controller
                  name="starts_immediately"
                  control={control}
                  render={({ field }) => (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="task-starts-now"
                        checked={field.value}
                        onCheckedChange={(v) => field.onChange(v === true)}
                      />
                      <Label htmlFor="task-starts-now">Starts immediately</Label>
                    </div>
                  )}
                />
                {!startsImmediately && (
                  <div className="space-y-1.5">
                    <Label htmlFor="task-start" className="text-muted-foreground text-xs">
                      Not before
                    </Label>
                    <Input
                      id="task-start"
                      type="date"
                      min={todayYMD()}
                      {...register("start_date")}
                    />
                    {errors.start_date && (
                      <p className="text-destructive text-xs">{errors.start_date.message}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Repeat */}
            <div className="space-y-1.5">
              <Label>Repeat</Label>
              <Controller
                name="rrule"
                control={control}
                render={({ field }) => {
                  const selectValue = customIntervalMode
                    ? CUSTOM_INTERVAL
                    : selectRepeatValue(field.value)
                  const days = parseByday(field.value)
                  const onRepeatChange = (val: string) => {
                    if (val === CUSTOM_INTERVAL) {
                      // "Every N days/weeks/months…": keep an existing interval, else
                      // seed at every-2 (1 is just the plain "Every day/week" preset).
                      setCustomIntervalMode(true)
                      const existing = parseInterval(field.value)
                      const n = existing && existing.n >= 2 ? existing.n : 2
                      const unit = existing?.unit ?? "day"
                      setIntervalEvery(String(n))
                      setIntervalUnit(unit)
                      field.onChange(intervalRrule(n, unit, days))
                    } else {
                      setCustomIntervalMode(false)
                      // Switching between weekly cadences keeps any pinned days.
                      const p = parseInterval(val)
                      field.onChange(
                        p?.unit === "week" && days.length ? intervalRrule(p.n, "week", days) : val,
                      )
                    }
                  }
                  // Weekly cadences (any N) get the optional Day control; empty = Auto.
                  const weekly = parseInterval(field.value)
                  const weeklyN = weekly?.unit === "week" ? weekly.n : null
                  const onToggleDays = (next: string[]) => {
                    if (weeklyN === null) return
                    field.onChange(intervalRrule(weeklyN, "week", next as WeekdayCode[]))
                  }
                  return (
                    <>
                      <Select value={selectValue} onValueChange={onRepeatChange}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TASK_RRULE_OPTIONS.filter((o) => !o.value.includes("BYDAY")).map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                          <SelectItem value={CUSTOM_INTERVAL}>Every N days/weeks/months…</SelectItem>
                        </SelectContent>
                      </Select>

                      {selectValue === CUSTOM_INTERVAL && (
                        <div className="flex items-center gap-2 pt-1">
                          <span className="text-sm">Every</span>
                          <Input
                            type="number"
                            min={1}
                            max={365}
                            inputMode="numeric"
                            className="w-20"
                            aria-label="Interval amount"
                            value={intervalEvery}
                            onChange={(e) => {
                              const raw = e.target.value
                              setIntervalEvery(raw)
                              const n = parseInt(raw, 10)
                              // Update the rule live for valid entries; defer clamping to
                              // blur so the box can be cleared/retyped without snapping back.
                              if (!Number.isNaN(n) && n >= 1) {
                                field.onChange(intervalRrule(Math.min(n, 365), intervalUnit, days))
                              }
                            }}
                            onBlur={() => {
                              const n = parseInt(intervalEvery, 10)
                              const clamped = Number.isNaN(n) || n < 1 ? 2 : Math.min(n, 365)
                              setIntervalEvery(String(clamped))
                              field.onChange(intervalRrule(clamped, intervalUnit, days))
                            }}
                          />
                          <Select
                            value={intervalUnit}
                            onValueChange={(u) => {
                              const unit = u as IntervalUnit
                              setIntervalUnit(unit)
                              const n = parseInt(intervalEvery, 10)
                              field.onChange(
                                intervalRrule(Number.isNaN(n) || n < 1 ? 2 : n, unit, days),
                              )
                            }}
                          >
                            <SelectTrigger className="flex-1">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(["day", "week", "month"] as const).map((u) => (
                                <SelectItem key={u} value={u}>
                                  {(parseInt(intervalEvery, 10) || 1) === 1 ? u : `${u}s`}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {isPhaseAuto(field.value) && (
                        <div className="flex flex-col gap-1.5 pt-2">
                          <Label className="text-muted-foreground text-xs">Start day</Label>
                          <Controller
                            name="start_pinned"
                            control={control}
                            render={({ field: pin }) => (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={pin.value ? "outline" : "default"}
                                  className="rounded-full"
                                  onClick={() => pin.onChange(false)}
                                >
                                  Auto
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={pin.value ? "default" : "outline"}
                                  className="rounded-full"
                                  onClick={() => {
                                    pin.onChange(true)
                                    if (!startDate) setValue("start_date", todayYMD())
                                  }}
                                >
                                  On a date
                                </Button>
                              </div>
                            )}
                          />
                          {startPinned ? (
                            <>
                              <Input
                                id="task-start"
                                type="date"
                                min={editing ? undefined : todayYMD()}
                                {...register("start_date")}
                              />
                              {errors.start_date && (
                                <p className="text-destructive text-xs">{errors.start_date.message}</p>
                              )}
                              <p className="text-muted-foreground text-xs">
                                It first happens on this date and repeats from there. The app
                                won&apos;t move it.
                              </p>
                            </>
                          ) : (
                            <p className="text-muted-foreground text-xs">
                              The app picks the starting day that best balances everyone&apos;s
                              chores.
                              {editing?.day_pinned === false && editing.start_date >= todayYMD()
                                ? ` Currently starting ${formatTaskDate(editing.start_date)}.`
                                : ""}
                            </p>
                          )}
                        </div>
                      )}

                      {weeklyN !== null && (
                        <div className="flex flex-col gap-1.5 pt-2">
                          <Label className="text-muted-foreground text-xs">Day</Label>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              variant={days.length === 0 ? "default" : "outline"}
                              className="rounded-full"
                              onClick={() => onToggleDays([])}
                            >
                              Auto
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="rounded-full"
                              onClick={() => onToggleDays(["MO", "TU", "WE", "TH", "FR"])}
                            >
                              Weekdays
                            </Button>
                            <ToggleGroup
                              type="multiple"
                              variant="outline"
                              value={days}
                              onValueChange={onToggleDays}
                              className="flex flex-wrap justify-start"
                            >
                              {WEEKDAYS.map((d) => (
                                <ToggleGroupItem
                                  key={d.code}
                                  value={d.code}
                                  aria-label={d.label}
                                  className="w-12 rounded-full data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary data-[state=on]:hover:text-primary-foreground"
                                >
                                  {d.label}
                                </ToggleGroupItem>
                              ))}
                            </ToggleGroup>
                          </div>
                        </div>
                      )}

                      {isAutoWeekly && (
                        <p className="text-muted-foreground pt-1 text-xs">
                          {editing && parseByday(editing.rrule).length === 1 && !editing.day_pinned
                            ? `Currently on ${WEEKDAYS.find((d) => d.code === parseByday(editing.rrule)[0])?.label}s. `
                            : ""}
                          The app picks the day that best balances everyone&apos;s chores.{" "}
                          Pick a day above to choose it yourself.
                        </p>
                      )}

                      {isRecurring && (
                        <div className="flex flex-col gap-1.5 pt-2">
                          <Label htmlFor="task-end" className="text-muted-foreground text-xs">
                            Ends (optional)
                          </Label>
                          <Input
                            id="task-end"
                            type="date"
                            min={startDate}
                            {...register("end_date")}
                          />
                          <p className="text-muted-foreground text-xs">
                            Leave blank to repeat forever. The chore stops after this date.
                          </p>
                        </div>
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

            {/* Estimated time (F30 — feeds the chore balancer) */}
            <div className="space-y-1.5">
              <Label>How long does it take?</Label>
              <Controller
                name="estimated_minutes"
                control={control}
                render={({ field }) => (
                  <div className="rounded-2xl border">
                    <TimeWheel
                      buckets={[UNSET_BUCKET, ...TIME_BUCKETS]}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  </div>
                )}
              />
              <p className="text-muted-foreground text-xs">
                Spin to pick a range. Used to balance the load fairly when you auto-plan chores.
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

                            {/* Anchor only matters for calendar-based cadences (not per-occurrence). */}
                            {rotationUnit !== "occurrence" && (
                              <div className="flex flex-col gap-1.5 pt-1">
                                <Label
                                  htmlFor="task-rotation-anchor"
                                  className="text-muted-foreground text-xs"
                                >
                                  Rotation starts on (optional)
                                </Label>
                                <Input
                                  id="task-rotation-anchor"
                                  type="date"
                                  {...register("rotation_anchor_date")}
                                />
                                <p className="text-muted-foreground text-xs">
                                  Which date the rotation cycle counts from. Defaults to the start date.
                                </p>
                              </div>
                            )}

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
