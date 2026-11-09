"use client"

import { useState } from "react"
import { toast } from "sonner"
import { ChevronLeftIcon, ChevronRightIcon, ImageOffIcon, Loader2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { ImageCandidate } from "@/lib/types/magic-import"

/**
 * Shows the photos found on a recipe's web page one at a time until the user confirms one.
 * Photos that fail to load, or are really tiny, are skipped automatically. Picking a photo
 * (or "No photo") ends the step; the chosen URL is copied to our server when the recipe is saved.
 */
export function RecipePhotoPicker({
  recipeName,
  candidates,
  onChoose,
}: {
  recipeName: string
  candidates: ImageCandidate[]
  /** The chosen photo URL, or null for no photo. */
  onChoose: (url: string | null) => void
}) {
  const [index, setIndex] = useState(0)
  const [loaded, setLoaded] = useState<Set<number>>(new Set())
  const [dead, setDead] = useState<Set<number>>(new Set())

  const alive = candidates.map((_, i) => i).filter((i) => !dead.has(i))
  const position = alive.indexOf(index)
  const current = candidates[index]

  function skipDead(i: number) {
    const nextDead = new Set(dead).add(i)
    setDead(nextDead)
    const remaining = candidates.map((_, k) => k).filter((k) => !nextDead.has(k))
    if (remaining.length === 0) {
      toast.info("None of the photos could be loaded.")
      onChoose(null)
      return
    }
    // Move on to the next live photo (or the last one before it).
    setIndex(remaining.find((k) => k > i) ?? remaining[remaining.length - 1])
  }

  function move(delta: number) {
    const target = alive[position + delta]
    if (target !== undefined) setIndex(target)
  }

  const nextIndex = alive[position + 1]
  if (!current) return null

  return (
    <Dialog open onOpenChange={(o) => !o && onChoose(null)}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="border-b p-5">
          <DialogTitle>Pick a photo</DialogTitle>
          <DialogDescription>
            Choose the best photo for {recipeName || "this recipe"}. We&apos;ll keep a copy so it
            never disappears.
          </DialogDescription>
        </DialogHeader>

        <div className="p-5">
          <div className="bg-muted relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-2xl">
            {!loaded.has(index) && (
              <Loader2Icon className="text-muted-foreground absolute size-6 animate-spin" />
            )}
            {/* Remote hotlink preview only; the server fetches its own copy when you pick one. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary external page photo; next/image would need per-host config */}
            <img
              key={current.url}
              src={current.url}
              alt={current.alt ?? "Recipe photo candidate"}
              referrerPolicy="no-referrer"
              className="size-full object-contain"
              onLoad={(e) => {
                const img = e.currentTarget
                if (img.naturalWidth < 150 || img.naturalHeight < 150) skipDead(index)
                else setLoaded((s) => new Set(s).add(index))
              }}
              onError={() => skipDead(index)}
            />
          </div>
          {/* Warm the next photo so Next feels instant. */}
          {nextIndex !== undefined && (
            // eslint-disable-next-line @next/next/no-img-element -- see above
            <img src={candidates[nextIndex].url} alt="" referrerPolicy="no-referrer" className="hidden" />
          )}
          <p className="text-muted-foreground mt-2 text-center text-xs tabular-nums">
            Photo {position + 1} of {alive.length}
          </p>
        </div>

        <div className="flex flex-col gap-2 border-t p-5">
          <Button type="button" onClick={() => onChoose(current.url)} disabled={!loaded.has(index)}>
            Use this photo
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => move(-1)}
              disabled={position <= 0}
            >
              <ChevronLeftIcon /> Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => move(1)}
              disabled={nextIndex === undefined}
            >
              Next photo <ChevronRightIcon />
            </Button>
          </div>
          <Button type="button" variant="ghost" onClick={() => onChoose(null)}>
            <ImageOffIcon /> No photo
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
