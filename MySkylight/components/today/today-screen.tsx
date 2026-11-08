"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { CheckIcon, StarIcon } from "lucide-react"

import { useApi } from "@/hooks/use-api"
import { useOccurrences } from "@/hooks/use-calendars"
import { useCompleteTask, useTaskOccurrences, useUncompleteTask } from "@/hooks/use-tasks"
import { useStarBalances } from "@/hooks/use-rewards"
import { useMealPlans } from "@/hooks/use-meals"
import { useRealtime } from "@/hooks/use-realtime"
import { useTodayYMD } from "@/hooks/use-today"
import { useWeatherDays } from "@/hooks/use-weather"
import { wmoEmoji } from "@/components/calendar/weather-icon"
import { AllDoneCelebration } from "@/components/tasks/all-done-celebration"
import { StarPop } from "@/components/tasks/star-pop"
import { MEAL_SLOTS } from "@/lib/types/meal"
import { cn } from "@/lib/utils"
import type { MemberBrief, OccurrenceOut } from "@/lib/types/calendar"
import type { TaskOccurrenceOut } from "@/lib/types/task"

const timeFmt: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" }

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase()
}

function greeting(hour: number) {
  if (hour < 5) return "Up late"
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}

/** The big clock + date + weather. Owns its own tick so only this re-renders. */
function Header({
  weather,
}: {
  weather: { code: number; maxTemp: number; minTemp: number; precipChance: number } | undefined
}) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 10_000)
    return () => clearInterval(id)
  }, [])

  return (
    <header className="flex items-end justify-between gap-6">
      <div>
        <p className="text-muted-foreground text-lg font-medium">{greeting(now.getHours())}</p>
        <p className="font-heading text-7xl leading-none font-semibold tracking-tight tabular-nums">
          {now.toLocaleTimeString(undefined, timeFmt)}
        </p>
        <p className="text-muted-foreground mt-2 text-xl">
          {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        </p>
      </div>
      {weather && (
        <div className="flex items-center gap-4 text-right">
          <span className="text-6xl" role="img" aria-label="Today's weather">
            {wmoEmoji(weather.code)}
          </span>
          <div>
            <p className="font-heading text-4xl font-semibold tabular-nums">
              {weather.maxTemp}°
              <span className="text-muted-foreground ml-1.5 text-2xl">{weather.minTemp}°</span>
            </p>
            {weather.precipChance >= 20 && (
              <p className="text-muted-foreground text-sm">{weather.precipChance}% chance of rain</p>
            )}
          </div>
        </div>
      )}
    </header>
  )
}

function eventSort(a: OccurrenceOut, b: OccurrenceOut) {
  if (a.all_day !== b.all_day) return a.all_day ? -1 : 1
  return a.start_dt.localeCompare(b.start_dt)
}

/** Today's events, with what's happening now highlighted and what's over dimmed. */
function Schedule({ occurrences }: { occurrences: OccurrenceOut[] }) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const sorted = useMemo(() => [...occurrences].sort(eventSort), [occurrences])

  return (
    <section className="bg-card ring-foreground/5 flex min-h-0 flex-1 flex-col gap-3 rounded-3xl p-5 shadow-sm ring-1">
      <div className="flex items-baseline justify-between">
        <h2 className="font-heading text-2xl font-semibold">Today</h2>
        <Link href="/device/calendar" className="text-primary text-sm font-medium">
          Calendar
        </Link>
      </div>
      {sorted.length === 0 ? (
        <p className="text-muted-foreground flex flex-1 items-center justify-center text-lg">
          Nothing scheduled today 🎈
        </p>
      ) : (
        <ul className="thin-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {sorted.map((o) => {
            const start = new Date(o.start_dt).getTime()
            const end = new Date(o.end_dt).getTime()
            const isNow = !o.all_day && start <= nowMs && nowMs < end
            const isPast = !o.all_day && end <= nowMs
            return (
              <li
                key={`${o.event_id}:${o.occurrence_date}`}
                className={cn(
                  "flex items-center gap-3 rounded-2xl border-l-4 px-4 py-3",
                  isNow ? "bg-primary/10 ring-primary/40 ring-2" : "bg-muted/40",
                  isPast && "opacity-45",
                )}
                style={{ borderLeftColor: o.effective_color }}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg leading-tight font-medium">{o.title}</p>
                  <p className="text-muted-foreground text-sm">
                    {o.all_day
                      ? "All day"
                      : `${new Date(o.start_dt).toLocaleTimeString(undefined, timeFmt)} – ${new Date(
                          o.end_dt,
                        ).toLocaleTimeString(undefined, timeFmt)}`}
                    {o.location ? ` · ${o.location}` : ""}
                  </p>
                </div>
                {isNow && (
                  <span className="bg-primary text-primary-foreground rounded-full px-2.5 py-0.5 text-xs font-semibold">
                    Now
                  </span>
                )}
                <div className="flex -space-x-1.5">
                  {o.members.map((m) => (
                    <span
                      key={m.id}
                      title={m.name}
                      className="flex size-7 items-center justify-center rounded-full text-[0.65rem] font-semibold text-white ring-2 ring-white dark:ring-black"
                      style={{ backgroundColor: m.color }}
                    >
                      {initials(m.name)}
                    </span>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** One tappable chore line on a person's card. */
function ChoreLine({
  occurrence,
  done,
  onToggle,
}: {
  occurrence: TaskOccurrenceOut
  done: boolean
  onToggle: () => void
}) {
  const [popKey, setPopKey] = useState(0)
  return (
    <li className="relative">
      <StarPop amount={occurrence.star_value} popKey={popKey} />
      <button
        type="button"
        aria-pressed={done}
        onClick={() => {
          if (!done) setPopKey((k) => k + 1)
          onToggle()
        }}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
          done ? "bg-muted/50" : "hover:bg-muted/40",
        )}
      >
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-lg border-2"
          style={
            done
              ? { backgroundColor: occurrence.effective_color, borderColor: occurrence.effective_color }
              : { borderColor: occurrence.effective_color }
          }
        >
          {done && <CheckIcon className="size-4 text-white" />}
        </span>
        <span className={cn("min-w-0 flex-1 truncate text-lg", done && "text-muted-foreground line-through")}>
          {occurrence.icon && <span className="mr-2">{occurrence.icon}</span>}
          {occurrence.title}
        </span>
        {occurrence.star_value > 0 && (
          <span className={cn("flex items-center gap-0.5 text-sm font-semibold text-amber-600", done && "opacity-40")}>
            <StarIcon className="size-3.5 fill-amber-400 text-amber-400" />
            {occurrence.star_value}
          </span>
        )}
      </button>
    </li>
  )
}

/** Each person's chores for today as a compact, tappable card. */
function Chores({
  familyId,
  today,
  members,
}: {
  familyId: string
  today: string
  members: MemberBrief[]
}) {
  const { data: occs = [] } = useTaskOccurrences(familyId, today, today)
  const { data: balances = [] } = useStarBalances(familyId)
  const complete = useCompleteTask(familyId)
  const uncomplete = useUncompleteTask(familyId)

  const stars = useMemo(() => new Map(balances.map((b) => [b.member_id, b.available])), [balances])
  const cards = useMemo(
    () =>
      members
        .map((member) => {
          const items = occs
            .filter((o) => !o.is_skipped && o.members.some((m) => m.id === member.id))
            // Still-to-do first, finished ones sink to the bottom.
            .sort((a, b) => {
              const ad = a.completed_member_ids.includes(member.id)
              const bd = b.completed_member_ids.includes(member.id)
              return ad === bd ? a.title.localeCompare(b.title) : ad ? 1 : -1
            })
          return { member, items }
        })
        .filter((c) => c.items.length > 0),
    [members, occs],
  )

  function toggle(o: TaskOccurrenceOut, memberId: string, done: boolean) {
    const vars = { taskId: o.task_id, memberId, occurrenceDate: o.occurrence_date }
    if (done) uncomplete.mutate(vars)
    else complete.mutate(vars)
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="font-heading text-2xl font-semibold">Chores</h2>
        <Link href="/device/chores" className="text-primary text-sm font-medium">
          All chores
        </Link>
      </div>
      {cards.length === 0 ? (
        <div className="bg-card ring-foreground/5 text-muted-foreground flex flex-1 items-center justify-center rounded-3xl p-5 text-lg shadow-sm ring-1">
          No chores today 🎉
        </div>
      ) : (
        <div className="thin-scrollbar grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-3 overflow-y-auto xl:grid-cols-2">
          {cards.map(({ member, items }) => {
            const doneCount = items.filter((o) => o.completed_member_ids.includes(member.id)).length
            const allDone = doneCount === items.length
            return (
              <div
                key={member.id}
                className="bg-card ring-foreground/5 relative flex flex-col gap-3 rounded-3xl p-4 shadow-sm ring-1"
              >
                <AllDoneCelebration active={allDone} />
                <div className="flex items-center gap-3">
                  <span
                    className="flex size-11 items-center justify-center rounded-full text-base font-semibold text-white"
                    style={{ backgroundColor: member.color }}
                  >
                    {initials(member.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-lg leading-tight font-semibold">{member.name}</p>
                    <p className="text-muted-foreground text-sm">
                      {allDone ? "All done — nice work!" : `${doneCount} of ${items.length} done`}
                    </p>
                  </div>
                  {stars.has(member.id) && (
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-base font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                      <StarIcon className="size-4 fill-amber-400 text-amber-400" />
                      {stars.get(member.id)}
                    </span>
                  )}
                </div>
                <div className="bg-muted h-2 overflow-hidden rounded-full">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${(doneCount / items.length) * 100}%`,
                      backgroundColor: member.color,
                    }}
                  />
                </div>
                <ul className="flex flex-col gap-1.5">
                  {items.map((o) => (
                    <ChoreLine
                      key={o.task_id}
                      occurrence={o}
                      done={o.completed_member_ids.includes(member.id)}
                      onToggle={() => toggle(o, member.id, o.completed_member_ids.includes(member.id))}
                    />
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

/** Today's planned meals, one line, only when there's something planned. */
function Meals({ familyId, today }: { familyId: string; today: string }) {
  const { data: meals = [] } = useMealPlans(familyId, today, today)
  const planned = MEAL_SLOTS.map((slot) => ({
    slot,
    title: meals.filter((m) => m.slot === slot).map((m) => m.display_title).join(", "),
  })).filter((m) => m.title)
  if (planned.length === 0) return null

  return (
    <footer className="bg-card ring-foreground/5 flex flex-wrap items-center gap-x-8 gap-y-1 rounded-3xl px-5 py-3 shadow-sm ring-1">
      {planned.map((m) => (
        <p key={m.slot} className="text-lg">
          <span className="text-muted-foreground mr-2 text-sm font-medium tracking-wide uppercase">
            {m.slot}
          </span>
          {m.title}
        </p>
      ))}
      <Link href="/device/meals" className="text-primary ml-auto text-sm font-medium">
        Meals
      </Link>
    </footer>
  )
}

/**
 * The wall display's landing screen: the date and weather, today's events, each
 * person's chores (tap to check off) and what's for dinner — the "hub of the home"
 * in one glance. Everything is read from the same cached queries as the full
 * Calendar / Chores / Meals pages, so it stays live over the same realtime stream.
 */
export function TodayScreen({ familyId }: { familyId: string }) {
  const api = useApi()
  useRealtime(familyId)
  // Rolls over at midnight on its own — the display never reloads.
  const today = useTodayYMD()

  const { data: family } = useQuery({
    queryKey: ["family", familyId],
    queryFn: () =>
      api.get<{ weather_lat: number | null; weather_lng: number | null }>(`/families/${familyId}`),
    enabled: !!familyId,
  })
  const coords =
    family?.weather_lat != null && family?.weather_lng != null
      ? { lat: family.weather_lat, lng: family.weather_lng }
      : null
  const weatherByDate = useWeatherDays(familyId, coords, [today])

  const { data: members = [] } = useQuery({
    queryKey: ["members", familyId],
    queryFn: () => api.get<MemberBrief[]>(`/families/${familyId}/members`),
    enabled: !!familyId,
  })
  const { data: occurrences = [] } = useOccurrences(familyId, today, today)

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-hidden p-6">
      <Header weather={weatherByDate[today]} />
      <div className="grid min-h-0 flex-1 grid-cols-5 gap-4">
        <div className="col-span-2 flex min-h-0 flex-col">
          <Schedule occurrences={occurrences} />
        </div>
        <div className="col-span-3 flex min-h-0 flex-col">
          <Chores familyId={familyId} today={today} members={members} />
        </div>
      </div>
      <Meals familyId={familyId} today={today} />
    </div>
  )
}
