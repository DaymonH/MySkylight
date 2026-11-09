"use client"

import { useEffect, useState } from "react"
import { CheckIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { parseSteps } from "@/lib/recipe-steps"
import { fmtQty } from "@/lib/recipe-scale"
import { cn } from "@/lib/utils"
import type { RecipeOut } from "@/lib/types/meal"

/**
 * Cook mode: a full-screen, big-text view for use at the stove. Ingredients and steps can
 * be tapped off as you go, and the screen is kept awake while it's open (where the
 * browser supports the Screen Wake Lock API).
 */
export function CookMode({
  open,
  onClose,
  recipe,
  scale = 1,
}: {
  open: boolean
  onClose: () => void
  recipe: RecipeOut | null
  scale?: number
}) {
  // Keep the screen on while cooking. The lock is dropped when the tab is hidden, so
  // ask for it again when we come back.
  useEffect(() => {
    if (!open || !("wakeLock" in navigator)) return
    let lock: WakeLockSentinel | null = null
    let cancelled = false
    const acquire = async () => {
      try {
        const l = await navigator.wakeLock.request("screen")
        if (cancelled) void l.release()
        else lock = l
      } catch {
        // Denied (e.g. low battery) — cooking mode still works, the screen just may dim.
      }
    }
    void acquire()
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", onVisible)
      void lock?.release()
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="fixed inset-0 top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 sm:max-w-none"
      >
        {recipe && <CookBody key={recipe.id} recipe={recipe} scale={scale} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function CookBody({
  recipe,
  scale,
  onClose,
}: {
  recipe: RecipeOut
  scale: number
  onClose: () => void
}) {
  const steps = parseSteps(recipe.instructions)
  const [gotIngredients, setGotIngredients] = useState<Set<string>>(new Set())
  const [doneSteps, setDoneSteps] = useState<Set<number>>(new Set())
  const toggle = <T,>(set: Set<T>, v: T) => {
    const next = new Set(set)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    return next
  }
  // The first step you haven't ticked off is "current" and gets highlighted.
  const current = steps.findIndex((_, i) => !doneSteps.has(i))

  return (
    <>
      <header className="flex items-center gap-3 border-b px-5 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0 flex-1">
          <DialogTitle className="truncate text-xl">{recipe.name}</DialogTitle>
          <DialogDescription className="text-sm">
            Cook mode · screen stays on
          </DialogDescription>
        </div>
        <Button variant="outline" size="icon" aria-label="Close cook mode" onClick={onClose}>
          <XIcon />
        </Button>
      </header>

      <div className="thin-scrollbar flex-1 space-y-8 overflow-y-auto px-5 py-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <section>
          <h2 className="font-heading mb-3 text-lg font-semibold">Ingredients</h2>
          <ul className="flex flex-col gap-2">
            {recipe.ingredients.map((ing) => {
              const got = gotIngredients.has(ing.id)
              const measure = [ing.quantity != null ? fmtQty(ing.quantity * scale) : "", ing.unit ?? ""]
                .filter(Boolean)
                .join(" ")
              return (
                <li key={ing.id}>
                  <button
                    type="button"
                    onClick={() => setGotIngredients((s) => toggle(s, ing.id))}
                    aria-pressed={got}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xl",
                      got && "text-muted-foreground line-through",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-lg border-2",
                        got ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
                      )}
                    >
                      {got && <CheckIcon className="size-5" />}
                    </span>
                    <span>
                      {measure && <span className="font-semibold">{measure} </span>}
                      {ing.name}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>

        {steps.length > 0 && (
          <section>
            <h2 className="font-heading mb-3 text-lg font-semibold">Steps</h2>
            <ol className="flex flex-col gap-3">
              {steps.map((step, i) => {
                const done = doneSteps.has(i)
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => setDoneSteps((s) => toggle(s, i))}
                      aria-pressed={done}
                      className={cn(
                        "flex w-full gap-4 rounded-2xl border-2 p-4 text-left text-xl leading-relaxed transition-colors",
                        done && "text-muted-foreground border-transparent line-through opacity-60",
                        !done && i === current ? "border-primary bg-primary/5" : !done && "border-transparent",
                      )}
                    >
                      <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-full text-base font-semibold tabular-nums">
                        {done ? <CheckIcon className="size-5" /> : i + 1}
                      </span>
                      <span className="break-words">{step}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </section>
        )}
      </div>
    </>
  )
}
