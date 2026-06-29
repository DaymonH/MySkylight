"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

export interface TimeBucket {
  label: string
  max: number // upper bound of the range (minutes)
  rep: number // representative minutes we store / feed the balancer
}

// Real time ranges for a chore. `rep` (the bucket's representative minutes) is what
// gets saved as `estimated_minutes` and used as the balancer's load weight.
export const TIME_BUCKETS: TimeBucket[] = [
  { label: "0–5 min", max: 5, rep: 5 },
  { label: "5–10 min", max: 10, rep: 10 },
  { label: "10–15 min", max: 15, rep: 15 },
  { label: "15–20 min", max: 20, rep: 20 },
  { label: "20–30 min", max: 30, rep: 30 },
  { label: "30–45 min", max: 45, rep: 45 },
  { label: "45–60 min", max: 60, rep: 60 },
  { label: "1–1.5 hr", max: 90, rep: 90 },
  { label: "1.5–2 hr", max: 120, rep: 120 },
  { label: "2+ hr", max: 1440, rep: 150 },
]

// Leading option for the task editor so an estimate stays optional (rep 0 → null).
export const UNSET_BUCKET: TimeBucket = { label: "Not sure", max: 0, rep: 0 }

/** The bucket index whose range holds `minutes`. */
export function bucketIndex(buckets: TimeBucket[], minutes: number | null): number {
  if (minutes == null || minutes <= 0) return 0
  const exact = buckets.findIndex((b) => b.rep === minutes)
  if (exact >= 0) return exact
  const within = buckets.findIndex((b) => b.rep > 0 && minutes <= b.max)
  return within >= 0 ? within : buckets.length - 1
}

/** Human label for a stored minutes value, using the standard buckets. */
export function bucketLabel(minutes: number | null): string {
  if (minutes == null || minutes <= 0) return "Not set"
  return TIME_BUCKETS[bucketIndex(TIME_BUCKETS, minutes)].label
}

const ITEM_H = 34
const VISIBLE = 5 // odd, so there's a clear centre row
const PAD = (VISIBLE - 1) / 2 // blank rows so the first/last can centre

/**
 * A touch-friendly rolling wheel for picking a time bucket. Scroll-snaps to the
 * centred row; the centred bucket is the selection. Dependency-free.
 */
export function TimeWheel({
  buckets,
  value,
  onChange,
  className,
}: {
  buckets: TimeBucket[]
  value: number | null
  onChange: (rep: number) => void
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [active, setActive] = useState(() => bucketIndex(buckets, value))

  // Snap the wheel to the external value (open, reset, switch chore).
  /* eslint-disable react-hooks/set-state-in-effect -- syncing to an external value */
  useEffect(() => {
    const idx = bucketIndex(buckets, value)
    setActive(idx)
    if (ref.current) ref.current.scrollTop = idx * ITEM_H
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  /* eslint-enable react-hooks/set-state-in-effect */

  function handleScroll() {
    const el = ref.current
    if (!el) return
    const idx = Math.max(0, Math.min(buckets.length - 1, Math.round(el.scrollTop / ITEM_H)))
    setActive(idx)
    if (settle.current) clearTimeout(settle.current)
    // Commit once scrolling settles, so dragging through rows doesn't spam onChange.
    settle.current = setTimeout(() => {
      const rep = buckets[idx].rep
      if (rep !== (value ?? 0)) onChange(rep)
    }, 110)
  }

  return (
    <div className={cn("relative select-none", className)} style={{ height: VISIBLE * ITEM_H }}>
      {/* centre selection band */}
      <div
        className="bg-muted pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-lg"
        style={{ height: ITEM_H }}
      />
      {/* top / bottom fades */}
      <div
        className="from-background pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b to-transparent"
        style={{ height: ITEM_H * 1.5 }}
      />
      <div
        className="from-background pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t to-transparent"
        style={{ height: ITEM_H * 1.5 }}
      />
      <div
        ref={ref}
        onScroll={handleScroll}
        className="relative h-full snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div style={{ height: PAD * ITEM_H }} aria-hidden />
        {buckets.map((b, i) => (
          <button
            key={b.label}
            type="button"
            onClick={() => ref.current?.scrollTo({ top: i * ITEM_H, behavior: "smooth" })}
            className={cn(
              "flex w-full snap-center items-center justify-center text-sm transition-all",
              i === active ? "text-foreground font-semibold" : "text-muted-foreground/50 scale-90",
            )}
            style={{ height: ITEM_H }}
          >
            {b.label}
          </button>
        ))}
        <div style={{ height: PAD * ITEM_H }} aria-hidden />
      </div>
    </div>
  )
}
