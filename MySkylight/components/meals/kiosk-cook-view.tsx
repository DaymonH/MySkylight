"use client"

import { Fragment, useRef, useState } from "react"
import {
  ArrowLeftIcon,
  BellRingIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MinusIcon,
  PlusIcon,
  TimerIcon,
  XIcon,
} from "lucide-react"

import { useCookTimers } from "@/hooks/use-cook-timers"
import { clock, findTimers } from "@/lib/recipe-timers"
import { parseSteps } from "@/lib/recipe-steps"
import { fmtQty, scaleFactor } from "@/lib/recipe-scale"
import { cn } from "@/lib/utils"
import type { RecipeOut } from "@/lib/types/meal"

/**
 * The wall-display recipe reader, built for cooking: ingredients on the left (big tap-to-check
 * rows, scalable), the current step on the right in very large type with Back / Next, and
 * one-tap timers for any time written in a step. Landscape-first; stacks on a narrow screen.
 */
export function KioskCookView({
  recipe,
  onBack,
}: {
  recipe: RecipeOut
  onBack: () => void
}) {
  const steps = parseSteps(recipe.instructions)
  const base = recipe.servings && recipe.servings > 0 ? recipe.servings : null
  const [servings, setServings] = useState<number | null>(base)
  const scale = scaleFactor(recipe, servings)
  const [got, setGot] = useState<Set<string>>(new Set())
  const [step, setStep] = useState(0)
  const { timers, now, start, dismiss } = useCookTimers()

  // Swipe left/right to change step (the Next/Back buttons are the primary control).
  const touchX = useRef<number | null>(null)
  const lastStep = Math.max(0, steps.length - 1)
  const go = (d: number) => setStep((s) => Math.min(lastStep, Math.max(0, s + d)))

  const toggleGot = (id: string) =>
    setGot((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const total = (recipe.prep_minutes ?? 0) + (recipe.cook_minutes ?? 0)

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center gap-4 border-b px-5 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-12 shrink-0 items-center justify-center rounded-xl transition-colors"
        >
          <ArrowLeftIcon className="size-7" />
        </button>
        {recipe.image_url && (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary external recipe URL; next/image would need per-host config
          <img src={recipe.image_url} alt="" className="size-14 shrink-0 rounded-xl object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="font-heading truncate text-3xl font-semibold tracking-tight">{recipe.name}</h1>
          {total > 0 && <p className="text-muted-foreground text-sm">{total} min total</p>}
        </div>

        {/* Running timers */}
        <div className="flex max-w-[45%] items-center gap-2 overflow-x-auto">
          {timers.map((t) => {
            const left = (t.endsAt - now) / 1000
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label={t.done ? `Dismiss ${t.label} timer` : `Cancel ${t.label} timer`}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-2xl border-2 px-4 py-2 text-left",
                  t.done
                    ? "border-destructive bg-destructive text-destructive-foreground animate-pulse"
                    : "border-primary/40 bg-primary/10",
                )}
              >
                {t.done ? <BellRingIcon className="size-6" /> : <TimerIcon className="size-6" />}
                <span className="leading-tight">
                  <span className="block text-2xl font-semibold tabular-nums">
                    {t.done ? "Done!" : clock(left)}
                  </span>
                  <span className="block max-w-32 truncate text-xs opacity-80">{t.label}</span>
                </span>
                <XIcon className="size-4 opacity-60" />
              </button>
            )
          })}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Ingredients */}
        <aside className="thin-scrollbar flex max-h-[40%] min-h-0 flex-col overflow-y-auto border-b p-5 md:max-h-none md:w-[36%] md:shrink-0 md:border-r md:border-b-0">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-heading text-xl font-semibold">Ingredients</h2>
            {base != null && servings != null && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Fewer servings"
                  disabled={servings <= 1}
                  onClick={() => setServings(servings - 1)}
                  className="bg-muted flex size-10 items-center justify-center rounded-full disabled:opacity-40"
                >
                  <MinusIcon className="size-5" />
                </button>
                <span className="w-24 text-center text-base tabular-nums">
                  {servings} {servings === 1 ? "serving" : "servings"}
                </span>
                <button
                  type="button"
                  aria-label="More servings"
                  disabled={servings >= 99}
                  onClick={() => setServings(servings + 1)}
                  className="bg-muted flex size-10 items-center justify-center rounded-full disabled:opacity-40"
                >
                  <PlusIcon className="size-5" />
                </button>
              </div>
            )}
          </div>
          {recipe.ingredients.length === 0 ? (
            <p className="text-muted-foreground">No ingredients listed.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {recipe.ingredients.map((ing, idx) => {
                const section = (ing.section ?? "").trim()
                const prev = idx > 0 ? (recipe.ingredients[idx - 1].section ?? "").trim() : ""
                const measure = [ing.quantity != null ? fmtQty(ing.quantity * scale) : "", ing.unit ?? ""]
                  .filter(Boolean)
                  .join(" ")
                const isGot = got.has(ing.id)
                return (
                  <Fragment key={ing.id}>
                    {section && section !== prev && (
                      <li className="text-muted-foreground mt-3 text-sm font-semibold tracking-wide uppercase">
                        {section}
                      </li>
                    )}
                    <li>
                      <button
                        type="button"
                        onClick={() => toggleGot(ing.id)}
                        aria-pressed={isGot}
                        className={cn(
                          "flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-xl leading-snug",
                          isGot && "text-muted-foreground line-through",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-8 shrink-0 items-center justify-center rounded-lg border-2",
                            isGot ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
                          )}
                        >
                          {isGot && <CheckIcon className="size-5" />}
                        </span>
                        <span>
                          {measure && <span className="font-semibold">{measure} </span>}
                          {ing.name}
                        </span>
                      </button>
                    </li>
                  </Fragment>
                )
              })}
            </ul>
          )}
        </aside>

        {/* Current step */}
        <section
          className="flex min-h-0 min-w-0 flex-1 flex-col p-5"
          onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
          onTouchEnd={(e) => {
            if (touchX.current == null) return
            const dx = e.changedTouches[0].clientX - touchX.current
            touchX.current = null
            if (Math.abs(dx) > 80) go(dx < 0 ? 1 : -1)
          }}
        >
          {steps.length === 0 ? (
            <p className="text-muted-foreground m-auto text-2xl">No instructions yet.</p>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-3">
                <h2 className="font-heading text-xl font-semibold">
                  Step {step + 1} <span className="text-muted-foreground font-normal">of {steps.length}</span>
                </h2>
                <div className="flex flex-1 gap-1" aria-hidden>
                  {steps.map((_, i) => (
                    <span
                      key={i}
                      className={cn("h-1.5 flex-1 rounded-full", i <= step ? "bg-primary" : "bg-muted")}
                    />
                  ))}
                </div>
              </div>

              <div className="thin-scrollbar flex-1 overflow-y-auto">
                <StepText
                  text={steps[step]}
                  onTimer={(label, seconds) => start(label, seconds)}
                />
                {step < lastStep && (
                  <p className="text-muted-foreground mt-8 border-t pt-4 text-xl leading-snug">
                    <span className="text-sm font-semibold tracking-wide uppercase">Next · </span>
                    {steps[step + 1]}
                  </p>
                )}
              </div>

              <div className="mt-4 flex gap-4">
                <button
                  type="button"
                  onClick={() => go(-1)}
                  disabled={step === 0}
                  className="bg-muted flex h-20 flex-1 items-center justify-center gap-2 rounded-2xl text-2xl font-semibold disabled:opacity-40"
                >
                  <ChevronLeftIcon className="size-8" /> Back
                </button>
                {step < lastStep ? (
                  <button
                    type="button"
                    onClick={() => go(1)}
                    className="bg-primary text-primary-foreground flex h-20 flex-[2] items-center justify-center gap-2 rounded-2xl text-3xl font-semibold"
                  >
                    Next <ChevronRightIcon className="size-9" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onBack}
                    className="bg-primary text-primary-foreground flex h-20 flex-[2] items-center justify-center gap-2 rounded-2xl text-3xl font-semibold"
                  >
                    <CheckIcon className="size-9" /> All done
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

/** The step in large type, with each cooking time turned into a tap-to-start timer. */
function StepText({
  text,
  onTimer,
}: {
  text: string
  onTimer: (label: string, seconds: number) => void
}) {
  const timers = findTimers(text)
  const parts: React.ReactNode[] = []
  let cursor = 0
  timers.forEach((t, i) => {
    if (t.index > cursor) parts.push(text.slice(cursor, t.index))
    parts.push(
      <button
        key={i}
        type="button"
        onClick={() => onTimer(t.text, t.seconds)}
        aria-label={`Start a ${t.text} timer`}
        className="bg-primary/15 text-primary hover:bg-primary/25 mx-0.5 inline-flex items-center gap-1.5 rounded-xl px-3 py-0.5 align-baseline font-semibold"
      >
        <TimerIcon className="size-7" />
        {t.text}
      </button>,
    )
    cursor = t.index + t.text.length
  })
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <p className="text-[2.4rem] leading-snug font-medium break-words">{parts}</p>
}
