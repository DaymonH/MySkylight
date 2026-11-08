"use client"

import { CHORE_EMOJI } from "@/lib/chore-icons"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * Emoji picker for a chore: a grid of common ones plus a text box for anything else
 * (the device's own emoji keyboard works there). Empty means "no icon".
 */
export function IconPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {CHORE_EMOJI.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => onChange(value === e ? "" : e)}
            aria-pressed={value === e}
            aria-label={`Use ${e}`}
            className={cn(
              "flex size-9 items-center justify-center rounded-lg border text-lg transition-colors",
              value === e ? "border-primary bg-primary/10" : "hover:bg-muted/60",
            )}
          >
            {e}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={8}
          placeholder="Or type any emoji"
          aria-label="Chore emoji"
          className="w-44"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-muted-foreground text-xs underline"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  )
}
