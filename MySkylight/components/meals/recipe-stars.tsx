"use client"

import { StarIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/** 1–5 star rating. Interactive when `onChange` is given (tap the same star to clear). */
export function RecipeStars({
  value,
  onChange,
  size = "size-4",
}: {
  value: number | null
  onChange?: (v: number | null) => void
  size?: string
}) {
  return (
    <span className="inline-flex items-center" role={onChange ? "radiogroup" : "img"} aria-label={value ? `${value} of 5 stars` : "Not rated"}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = (value ?? 0) >= n
        const star = (
          <StarIcon
            className={cn(size, on ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")}
          />
        )
        return onChange ? (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            onClick={() => onChange(value === n ? null : n)}
            className="p-1"
          >
            {star}
          </button>
        ) : (
          <span key={n}>{star}</span>
        )
      })}
    </span>
  )
}
