"use client"

import { StarIcon } from "lucide-react"

/**
 * A "+N ★" that floats up and fades when a chore is checked off — the instant
 * feedback that a tap earned something. Render it inside a `relative` row and bump
 * `popKey` on each completion: the key restarts the CSS animation, and 0 renders
 * nothing. It's decorative (the row's star chip carries the value), so it's hidden
 * from assistive tech and from anyone who prefers reduced motion (see `.star-pop`).
 */
export function StarPop({ amount, popKey }: { amount: number; popKey: number }) {
  if (popKey === 0 || amount <= 0) return null
  return (
    <span
      key={popKey}
      aria-hidden
      className="star-pop pointer-events-none absolute -top-1 right-4 z-10 flex items-center gap-0.5 text-lg font-bold text-amber-500"
    >
      +{amount}
      <StarIcon className="size-4 fill-amber-400 text-amber-400" />
    </span>
  )
}
