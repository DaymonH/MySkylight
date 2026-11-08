"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Loader2Icon, StarIcon } from "lucide-react"

import { useAdjustStars, useStarAdjustments } from "@/hooks/use-rewards"
import { ApiError } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import type { StarBalanceOut } from "@/lib/types/reward"

type Mode = "set" | "add"

/**
 * A parent's tool for fixing someone's stars — e.g. after a backlog of chores was
 * ticked off without being done. "Set to" makes their spendable balance exactly a
 * number (Reset to 0 is one tap); "Add or remove" nudges it up or down. Each change is
 * kept in a short history with its note, and no completion is ever deleted.
 *
 * Mount it with `key={member_id}` so each person starts from a clean form.
 */
export function AdjustStarsDialog({
  familyId,
  balance,
  onClose,
}: {
  familyId: string
  balance: StarBalanceOut
  onClose: () => void
}) {
  const adjust = useAdjustStars(familyId)
  const { data: history = [] } = useStarAdjustments(familyId, balance.member_id)
  const [mode, setMode] = useState<Mode>("set")
  const [value, setValue] = useState("")
  const [note, setNote] = useState("")

  const n = value.trim() === "" ? null : Number(value)
  const valid =
    n !== null &&
    Number.isInteger(n) &&
    (mode === "set" ? n >= 0 && n <= 100_000 : n !== 0 && Math.abs(n) <= 100_000)
  const after = valid ? (mode === "set" ? n : balance.available + n) : null

  function submit() {
    if (!valid || n === null) return
    adjust.mutate(
      {
        member_id: balance.member_id,
        ...(mode === "set" ? { set_available_to: n } : { amount: n }),
        note: note.trim() || null,
      },
      {
        onSuccess: (res) => {
          toast.success(
            res.adjustment
              ? `${balance.name} now has ${res.balance.available} star${res.balance.available === 1 ? "" : "s"}`
              : `${balance.name} already had that many stars`,
          )
          onClose()
        },
        onError: (err) =>
          toast.error(err instanceof ApiError && err.message ? err.message : "Couldn't change the stars"),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust {balance.name}&rsquo;s stars</DialogTitle>
          <DialogDescription>
            Fix a balance that&rsquo;s wrong, like stars from chores that were ticked off without
            being done. Chore history isn&rsquo;t changed.
          </DialogDescription>
        </DialogHeader>

        <p className="flex items-center gap-1.5 text-sm">
          Right now:
          <span className="flex items-center gap-1 font-semibold text-amber-500">
            <StarIcon className="size-4 fill-amber-400 text-amber-400" />
            {balance.available}
          </span>
          {balance.pending > 0 && (
            <span className="text-muted-foreground text-xs">({balance.pending} held for a reward)</span>
          )}
        </p>

        <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-muted p-1" role="radiogroup" aria-label="How to adjust">
          {(
            [
              ["set", "Set to a number"],
              ["add", "Add or remove"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => {
                setMode(m)
                setValue("")
              }}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                mode === m ? "bg-background shadow-sm" : "text-muted-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="stars-value">
            {mode === "set" ? "Stars they should have" : "Stars to add (use a minus to remove)"}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="stars-value"
              inputMode="numeric"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={mode === "set" ? "0" : "-5"}
              className="w-32"
            />
            {mode === "set" && (
              <Button type="button" variant="outline" size="sm" onClick={() => setValue("0")}>
                Reset to 0
              </Button>
            )}
          </div>
          {after !== null && (
            <p className="text-muted-foreground text-xs">
              {balance.name}: {balance.available} → <span className="font-medium text-foreground">{after}</span>{" "}
              star{after === 1 ? "" : "s"}
            </p>
          )}
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="stars-note">Note (optional)</Label>
          <Input
            id="stars-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="e.g. Backlog ticked off"
          />
        </div>

        {history.length > 0 && (
          <div className="grid gap-1">
            <p className="text-muted-foreground text-xs font-medium">Recent changes</p>
            <ul className="text-xs">
              {history.slice(0, 5).map((h) => (
                <li key={h.id} className="flex justify-between gap-3 py-0.5">
                  <span className="text-muted-foreground truncate">
                    {new Date(h.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    {h.note ? ` · ${h.note}` : ""}
                  </span>
                  <span className={cn("font-medium", h.amount < 0 ? "text-destructive" : "text-emerald-600")}>
                    {h.amount > 0 ? "+" : ""}
                    {h.amount}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={adjust.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || adjust.isPending}>
            {adjust.isPending && <Loader2Icon className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
