import { Skeleton } from "@/components/ui/skeleton"
import type { CalendarView } from "@/lib/types/calendar"

interface CalendarSkeletonProps {
  view: CalendarView
}

export function CalendarSkeleton({ view }: CalendarSkeletonProps) {
  if (view === "month") {
    return (
      <div className="grid h-full auto-rows-fr grid-cols-7 gap-px p-px">
        {Array.from({ length: 35 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5 p-1.5">
            <Skeleton className="size-6 rounded-full" />
            {i % 3 === 0 && <Skeleton className="h-3 w-full rounded" />}
            {i % 4 === 0 && <Skeleton className="h-3 w-2/3 rounded" />}
          </div>
        ))}
      </div>
    )
  }

  if (view === "schedule") {
    return (
      <div className="flex flex-col gap-4 p-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex gap-4">
            <Skeleton className="h-4 w-24 rounded" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-12 w-full rounded-2xl" />
              {i % 2 === 0 && <Skeleton className="h-12 w-full rounded-2xl" />}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // week / day — a column of hour rows
  return (
    <div className="flex flex-col gap-px p-3">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="flex items-start gap-3 py-2">
          <Skeleton className="h-3 w-10 rounded" />
          <Skeleton className="h-10 flex-1 rounded-xl" style={{ opacity: i % 3 === 0 ? 1 : 0.4 }} />
        </div>
      ))}
    </div>
  )
}
