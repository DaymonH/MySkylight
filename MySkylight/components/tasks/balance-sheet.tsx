"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import {
  ArrowRightIcon,
  CalendarRangeIcon,
  ChevronDownIcon,
  ClockIcon,
  Loader2Icon,
  RefreshCwIcon,
  ScaleIcon,
  SparklesIcon,
} from "lucide-react"

import { useApplyBalancePlan, useBalancePlan } from "@/hooks/use-tasks"
import { describeTaskRrule, WEEKDAYS } from "@/lib/recurrence"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet"
import { TimeWheel, TIME_BUCKETS, bucketLabel } from "@/components/tasks/time-wheel"
import type { MemberBrief } from "@/lib/types/calendar"
import type { TaskOut } from "@/lib/types/task"
import type { BalanceMode, BalancePlan, BalancePlanRequest } from "@/lib/types/balance"

interface ChoreConfig {
  mode: BalanceMode
  minutes: number // rough time-to-do (the load weight)
  lockDay: boolean
  fixedId: string
}

// Assumed time for a chore with no saved estimate, until the user sets one.
const DEFAULT_MINUTES = 15

const MODES: { value: BalanceMode; label: string; hint: string }[] = [
  { value: "rotate", label: "Split", hint: "Take turns" },
  { value: "fixed", label: "Fix", hint: "Always one person" },
  { value: "keep", label: "Leave", hint: "Don't change it" },
]

export function BalanceSheet({
  open,
  onClose,
  familyId,
  members,
  tasks,
}: {
  open: boolean
  onClose: () => void
  familyId: string
  members: MemberBrief[]
  tasks: TaskOut[]
}) {
  const recurring = useMemo(() => tasks.filter((t) => t.rrule), [tasks])

  const [step, setStep] = useState(1)
  const [selectedMembers, setSelectedMembers] = useState<string[]>([])
  const [allowedDays, setAllowedDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6])
  const [config, setConfig] = useState<Record<string, ChoreConfig>>({})
  const [seed, setSeed] = useState(0)

  const balancePlan = useBalancePlan(familyId)
  const applyPlan = useApplyBalancePlan(familyId)

  // Reset the wizard each time it opens (state derived from props on open).
  /* eslint-disable react-hooks/set-state-in-effect -- intentional reset on open */
  useEffect(() => {
    if (!open) return
    setStep(1)
    setSeed(0)
    balancePlan.reset()
    const allMembers = members.map((m) => m.id)
    setSelectedMembers(allMembers)
    setAllowedDays([0, 1, 2, 3, 4, 5, 6])
    setConfig(
      Object.fromEntries(
        recurring.map((t) => [
          t.id,
          {
            mode: "rotate" as BalanceMode,
            // Port in the saved estimate; fall back to a default until the user sets one.
            minutes: t.estimated_minutes ?? DEFAULT_MINUTES,
            lockDay: false,
            fixedId: t.members[0]?.id ?? allMembers[0] ?? "",
          },
        ]),
      ),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  /* eslint-enable react-hooks/set-state-in-effect */

  const memberById = useMemo(
    () => Object.fromEntries(members.map((m) => [m.id, m])),
    [members],
  )

  function setChore(taskId: string, patch: Partial<ChoreConfig>) {
    setConfig((prev) => ({ ...prev, [taskId]: { ...prev[taskId], ...patch } }))
  }

  function buildRequest(useSeed: number): BalancePlanRequest {
    return {
      member_ids: selectedMembers,
      items: recurring.map((t) => {
        const c = config[t.id]
        return {
          task_id: t.id,
          mode: c.mode,
          minutes: Math.max(1, c.minutes || DEFAULT_MINUTES),
          lock_day: c.lockDay,
          fixed_member_id: c.mode === "fixed" ? c.fixedId || selectedMembers[0] : null,
        }
      }),
      allowed_weekdays: allowedDays.length === 7 ? null : [...allowedDays].sort((a, b) => a - b),
      horizon_days: 28,
      seed: useSeed,
    }
  }

  function goToPreview() {
    setStep(3)
    balancePlan.mutate(buildRequest(seed))
  }

  function regenerate() {
    const next = seed + 1
    setSeed(next)
    balancePlan.mutate(buildRequest(next))
  }

  function apply() {
    applyPlan.mutate(buildRequest(seed), {
      onSuccess: (res) => {
        toast.success(
          res.updated === 0
            ? "Nothing to update"
            : `Balanced ${res.updated} chore${res.updated === 1 ? "" : "s"}`,
          { description: "Your tasks and the device will refresh in a moment." },
        )
        onClose()
      },
      onError: () => toast.error("Couldn't apply the plan. Please try again."),
    })
  }

  const canShare = selectedMembers.length >= 1
  const plan = balancePlan.data

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2 text-lg">
            <SparklesIcon className="size-5 text-violet-500" />
            Balance chores
          </SheetTitle>
          <p className="text-muted-foreground text-sm">
            {step === 1 && "Who's sharing the load, and which days work?"}
            {step === 2 && "Set how heavy each chore is and how to split it."}
            {step === 3 && "Here's a balanced plan. Tweak or apply it."}
          </p>
        </SheetHeader>

        <div className="thin-scrollbar flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
          {recurring.length === 0 ? (
            <p className="text-muted-foreground rounded-2xl border border-dashed p-6 text-center text-sm">
              Add some repeating chores first — the balancer arranges recurring tasks.
            </p>
          ) : step === 1 ? (
            <Step1
              members={members}
              selectedMembers={selectedMembers}
              setSelectedMembers={setSelectedMembers}
              allowedDays={allowedDays}
              setAllowedDays={setAllowedDays}
            />
          ) : step === 2 ? (
            <Step2
              recurring={recurring}
              config={config}
              setChore={setChore}
              selectedMembers={selectedMembers}
              memberById={memberById}
            />
          ) : (
            <Step3
              isPending={balancePlan.isPending}
              isError={balancePlan.isError}
              plan={plan}
              memberById={memberById}
            />
          )}
        </div>

        <SheetFooter className="flex-row items-center gap-2 border-t">
          {step > 1 ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep((s) => s - 1)}
              disabled={applyPlan.isPending}
            >
              Back
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
          )}

          {step === 1 && (
            <Button
              type="button"
              className="flex-1"
              onClick={() => setStep(2)}
              disabled={!canShare || recurring.length === 0}
            >
              Next
            </Button>
          )}
          {step === 2 && (
            <Button type="button" className="flex-1" onClick={goToPreview}>
              See the plan
            </Button>
          )}
          {step === 3 && (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={regenerate}
                disabled={balancePlan.isPending || applyPlan.isPending}
                title="Try another balanced layout"
              >
                <RefreshCwIcon className={balancePlan.isPending ? "animate-spin" : ""} />
                Regenerate
              </Button>
              <Button
                type="button"
                className="flex-1"
                onClick={apply}
                disabled={!plan || balancePlan.isPending || applyPlan.isPending}
              >
                {applyPlan.isPending ? <Loader2Icon className="animate-spin" /> : null}
                Apply plan
              </Button>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

// ── Step 1: people + days ─────────────────────────────────────────────────────

function Step1({
  members,
  selectedMembers,
  setSelectedMembers,
  allowedDays,
  setAllowedDays,
}: {
  members: MemberBrief[]
  selectedMembers: string[]
  setSelectedMembers: (v: string[]) => void
  allowedDays: number[]
  setAllowedDays: (v: number[]) => void
}) {
  return (
    <>
      <div className="space-y-2">
        <Label>Share between</Label>
        <ToggleGroup
          type="multiple"
          variant="outline"
          value={selectedMembers}
          onValueChange={(v) => v.length && setSelectedMembers(v)}
          className="flex flex-wrap justify-start"
        >
          {members.map((m) => {
            const on = selectedMembers.includes(m.id)
            return (
              <ToggleGroupItem
                key={m.id}
                value={m.id}
                className="gap-1.5 rounded-full"
                style={
                  on
                    ? { backgroundColor: m.color, borderColor: m.color, color: "#fff" }
                    : { borderColor: m.color }
                }
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: on ? "#fff" : m.color }}
                />
                {m.name}
              </ToggleGroupItem>
            )
          })}
        </ToggleGroup>
        <p className="text-muted-foreground text-xs">
          Chores you mark “Split” rotate between these people.
        </p>
      </div>

      <Separator />

      <div className="space-y-2">
        <Label>Days we do chores</Label>
        <ToggleGroup
          type="multiple"
          variant="outline"
          value={allowedDays.map((i) => WEEKDAYS[i].code)}
          onValueChange={(codes) => {
            const days = WEEKDAYS.map((d, i) => i).filter((i) => codes.includes(WEEKDAYS[i].code))
            if (days.length) setAllowedDays(days)
          }}
          className="flex flex-wrap justify-start"
        >
          {WEEKDAYS.map((d) => (
            <ToggleGroupItem
              key={d.code}
              value={d.code}
              aria-label={d.label}
              className="w-12 rounded-full data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              {d.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-muted-foreground text-xs">
          Weekly chores get placed on these days. Daily chores are left as-is.
        </p>
      </div>
    </>
  )
}

// ── Step 2: per-chore effort + split mode ─────────────────────────────────────

function Step2({
  recurring,
  config,
  setChore,
  selectedMembers,
  memberById,
}: {
  recurring: TaskOut[]
  config: Record<string, ChoreConfig>
  setChore: (taskId: string, patch: Partial<ChoreConfig>) => void
  selectedMembers: string[]
  memberById: Record<string, MemberBrief>
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  return (
    <ul className="flex flex-col gap-3">
      {recurring.map((t) => {
        const c = config[t.id]
        if (!c) return null
        const noEstimate = t.estimated_minutes == null
        return (
          <li key={t.id} className="bg-card ring-foreground/5 flex flex-col gap-3 rounded-2xl p-3 shadow-sm ring-1">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium leading-tight">{t.title}</p>
              <p className="text-muted-foreground text-xs">{describeTaskRrule(t.rrule)}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpenId((id) => (id === t.id ? null : t.id))}
                className={cn(
                  "gap-1.5",
                  noEstimate && "border-amber-400 text-amber-700 dark:text-amber-300",
                )}
              >
                <ClockIcon className="size-3.5" />
                {bucketLabel(c.minutes)}
                <ChevronDownIcon
                  className={cn("size-3.5 transition-transform", openId === t.id && "rotate-180")}
                />
              </Button>
              {noEstimate && (
                <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                  estimate?
                </span>
              )}

              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={c.mode}
                onValueChange={(v) => v && setChore(t.id, { mode: v as BalanceMode })}
                className="ml-auto"
              >
                {MODES.map((m) => (
                  <ToggleGroupItem
                    key={m.value}
                    value={m.value}
                    title={m.hint}
                    className="px-2.5 text-xs"
                  >
                    {m.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            {openId === t.id && (
              <div className="bg-background rounded-2xl border">
                <TimeWheel
                  buckets={TIME_BUCKETS}
                  value={c.minutes}
                  onChange={(rep) => setChore(t.id, { minutes: rep })}
                />
              </div>
            )}

            {c.mode === "fixed" && (
              <Select value={c.fixedId} onValueChange={(v) => setChore(t.id, { fixedId: v })}>
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue placeholder="Who does it?" />
                </SelectTrigger>
                <SelectContent>
                  {selectedMembers.map((id) => (
                    <SelectItem key={id} value={id}>
                      {memberById[id]?.name ?? "Member"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {c.mode !== "keep" && (
              <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                Keep it on its current day
                <Switch
                  checked={c.lockDay}
                  onCheckedChange={(on) => setChore(t.id, { lockDay: on })}
                  aria-label={`Keep ${t.title} on its day`}
                />
              </label>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ── Step 3: preview ───────────────────────────────────────────────────────────

function Step3({
  isPending,
  isError,
  plan,
  memberById,
}: {
  isPending: boolean
  isError: boolean
  plan: BalancePlan | undefined
  memberById: Record<string, MemberBrief>
}) {
  if (isPending) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-3 py-16 text-sm">
        <Loader2Icon className="size-6 animate-spin" />
        Crunching a balanced plan…
      </div>
    )
  }
  if (isError || !plan) {
    return (
      <p className="text-muted-foreground rounded-2xl border border-dashed p-6 text-center text-sm">
        Couldn’t build a plan. Go back and try again.
      </p>
    )
  }

  const maxLoad = Math.max(
    0.001,
    ...plan.preview.weekday_loads.flatMap((row) => Object.values(row)),
  )

  return (
    <div className="flex flex-col gap-5">
      {/* Per-person before → after */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ScaleIcon className="size-4" /> Weekly load
        </div>
        {plan.preview.people.map((p) => (
          <div key={p.member_id} className="flex items-center gap-2 text-sm">
            <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="flex-1 truncate">{p.name}</span>
            <span className="text-muted-foreground tabular-nums">{p.before_per_week}</span>
            <ArrowRightIcon className="text-muted-foreground size-3.5" />
            <span className="font-semibold tabular-nums">{p.after_per_week}</span>
            <span className="text-muted-foreground text-xs">min/wk</span>
          </div>
        ))}
        <p className="text-muted-foreground text-xs">
          Busiest day for one person: {plan.preview.busiest_before} → {plan.preview.busiest_after}{" "}
          min. Gap between people: {plan.preview.imbalance_before} →{" "}
          {plan.preview.imbalance_after} min/wk.
        </p>
      </div>

      <Separator />

      {/* Weekday heatmap (a typical week) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <CalendarRangeIcon className="size-4" /> A typical week
        </div>
        {WEEKDAYS.map((d, i) => {
          const row = plan.preview.weekday_loads[i] ?? {}
          return (
            <div key={d.code} className="flex items-center gap-2">
              <span className="text-muted-foreground w-9 text-xs">{d.label}</span>
              <div className="flex flex-1 flex-col gap-0.5">
                {plan.preview.people.map((p) => {
                  const load = row[p.member_id] ?? 0
                  return (
                    <div
                      key={p.member_id}
                      className="h-1.5 rounded-full"
                      style={{
                        width: `${Math.max(load > 0 ? 6 : 0, (load / maxLoad) * 100)}%`,
                        backgroundColor: p.color,
                        opacity: load > 0 ? 1 : 0,
                      }}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <Separator />

      {/* The actual changes */}
      <div className="flex flex-col gap-2">
        <div className="text-sm font-medium">What changes ({plan.changes.length})</div>
        <ul className="flex flex-col gap-1.5">
          {plan.changes.map((ch) => {
            const starter = ch.starter_id ? memberById[ch.starter_id] : undefined
            return (
              <li key={ch.task_id} className="flex items-center gap-2 text-sm">
                {starter && (
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: starter.color }}
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{ch.title}</span>
                <span className={cn("text-muted-foreground shrink-0 text-xs")}>{ch.summary}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
