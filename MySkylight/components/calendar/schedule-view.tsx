"use client"

import { CalendarPlusIcon, MapPinIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { readableTextOn } from "@/lib/colors"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import type { MemberBrief, OccurrenceOut } from "@/lib/types/calendar"

interface ScheduleViewProps {
  occurrences: OccurrenceOut[]
  onEventClick: (occ: OccurrenceOut) => void
  onAdd?: () => void
}

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function relativeDay(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00")
  const today = new Date()
  const todayYMD = toYMD(today)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (dateStr === todayYMD) return "Today"
  if (dateStr === toYMD(tomorrow)) return "Tomorrow"
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
}

function formatTime(dtStr: string, allDay: boolean) {
  if (allDay) return "All day"
  return new Date(dtStr).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

function MemberAvatars({ members }: { members: MemberBrief[] }) {
  return (
    <div className="flex -space-x-1.5">
      {members.slice(0, 3).map((m) => (
        <Avatar key={m.id} size="sm" className="ring-2 ring-background" title={m.name}>
          <AvatarFallback
            style={{ backgroundColor: m.color, color: readableTextOn(m.color) }}
            className="text-[10px] font-semibold"
          >
            {m.name.slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      ))}
      {members.length > 3 && (
        <span className="bg-muted text-muted-foreground ring-background flex size-6 items-center justify-center rounded-full text-[10px] font-medium ring-2">
          +{members.length - 3}
        </span>
      )}
    </div>
  )
}

export function ScheduleView({ occurrences, onEventClick, onAdd }: ScheduleViewProps) {
  if (occurrences.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 px-6 py-20 text-center">
        <div className="bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-2xl">
          <CalendarPlusIcon className="size-7" />
        </div>
        <div>
          <p className="font-heading text-base font-medium">Nothing coming up</p>
          <p className="text-muted-foreground mt-1 text-sm">Your next 90 days are clear.</p>
        </div>
        {onAdd && (
          <Button onClick={onAdd}>
            <CalendarPlusIcon />
            Add an event
          </Button>
        )}
      </div>
    )
  }

  // Group by date
  const groups = new Map<string, OccurrenceOut[]>()
  for (const occ of occurrences) {
    const key = occ.occurrence_date
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(occ)
  }
  const todayYMD = toYMD(new Date())

  return (
    <div className="mx-auto flex max-w-2xl flex-col">
      {[...groups.entries()].map(([date, evts]) => {
        const isToday = date === todayYMD
        return (
          <div key={date} className="flex gap-3 px-4 py-3 sm:gap-4">
            {/* Date column */}
            <div className="w-20 flex-shrink-0 pt-1 sm:w-24">
              <p className={cn("text-sm font-semibold", isToday ? "text-primary" : "text-foreground")}>
                {relativeDay(date)}
              </p>
            </div>

            {/* Events */}
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {evts.map((occ, i) => (
                <button
                  key={i}
                  onClick={() => onEventClick(occ)}
                  className="bg-card ring-foreground/5 hover:bg-accent/50 active:bg-accent group flex w-full min-w-0 items-start gap-3 rounded-2xl p-3 text-left shadow-sm ring-1 transition-colors"
                >
                  <span
                    className="mt-0.5 h-9 w-1 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: occ.effective_color }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium leading-snug break-words">{occ.title}</p>
                    <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                      {formatTime(occ.start_dt, occ.all_day)}
                    </p>
                    {occ.location && (
                      <p className="text-muted-foreground mt-0.5 flex items-start gap-1 text-xs">
                        <MapPinIcon className="mt-0.5 size-3 shrink-0" />
                        <span className="min-w-0 break-words">{occ.location}</span>
                      </p>
                    )}
                    {occ.is_countdown && occ.days_until !== null && (
                      <p className="mt-1 text-xs font-semibold" style={{ color: occ.effective_color }}>
                        {occ.days_until === 0 ? "🎉 Today!" : occ.days_until > 0 ? `${occ.days_until} days away` : "Past"}
                      </p>
                    )}
                  </div>
                  {occ.members.length > 0 && <MemberAvatars members={occ.members} />}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
