"use client"

import type { EditScope } from "@/lib/types/calendar"

export const SCOPE_OPTIONS: { value: EditScope; label: string; hint: string }[] = [
  { value: "this", label: "This event", hint: "Only this date" },
  { value: "following", label: "This and following events", hint: "From this date on" },
  { value: "all", label: "All events", hint: "The whole series" },
]

/** Radio-style picker for which occurrences an edit/delete applies to. */
export function ScopePicker({
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
