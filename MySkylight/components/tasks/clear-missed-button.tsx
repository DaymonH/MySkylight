"use client"

import { useState } from "react"
import { toast } from "sonner"
import { BrushCleaningIcon } from "lucide-react"

import { useClearMissed } from "@/hooks/use-tasks"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

/**
 * "Clear" for the Missed section: dismisses every missed chore up to `through`
 * (the day before the section's anchor) in one tap — the alternative to marking a
 * backlog done one row at a time. Crucially it is NOT a completion, so no stars are
 * awarded for chores nobody did. Confirms first, then offers Undo.
 */
export function ClearMissedButton({
  familyId,
  through,
  count,
  size = "sm",
}: {
  familyId: string
  /** YYYY-MM-DD: everything dated on or before this is dismissed. */
  through: string
  count: number
  size?: "sm" | "default"
}) {
  const clear = useClearMissed(familyId)
  const [open, setOpen] = useState(false)

  function handleClear() {
    clear.mutate(through, {
      onSuccess: (res) => {
        setOpen(false)
        toast.success(`Cleared ${count} missed chore${count === 1 ? "" : "s"}`, {
          description: "No stars were awarded.",
          action: {
            label: "Undo",
            onClick: () =>
              clear.mutate(res.previous_cleared_through, {
                onError: () => toast.error("Couldn't undo. Please try again."),
              }),
          },
        })
      },
      onError: () => toast.error("Couldn't clear missed chores. Please try again."),
    })
  }

  return (
    <>
      <Button
        variant="outline"
        size={size}
        onClick={() => setOpen(true)}
        className="border-amber-400/60 bg-transparent"
      >
        <BrushCleaningIcon />
        Clear
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Clear {count} missed chore{count === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They&rsquo;ll be dismissed as missed &mdash; <strong>no stars are
              awarded</strong>, since they weren&rsquo;t done. To get credit for a
              chore you did, mark it done instead. You can undo this right after.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clear.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Keep the dialog open until the request settles (handleClear closes it).
                e.preventDefault()
                handleClear()
              }}
              disabled={clear.isPending}
            >
              Clear missed
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
