"use client"

import { useMemo } from "react"
import { useRouter } from "next/navigation"
import { ChefHatIcon, Loader2Icon, UtensilsCrossedIcon } from "lucide-react"

import { useRealtime } from "@/hooks/use-realtime"
import { useMealPlans } from "@/hooks/use-meals"
import { cn } from "@/lib/utils"
import { MEAL_SLOTS, type MealPlanOut, type MealSlot } from "@/lib/types/meal"

const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
}

function startOfWeek(d: Date): Date {
  const x = new Date(d)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  x.setHours(0, 0, 0, 0)
  return x
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
function isoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}

/**
 * The device "meals" surface: a glanceable view of this week's planned meals,
 * with today highlighted. Read-only — planning happens in the companion app.
 */
export function MealBoard({ familyId }: { familyId: string }) {
  useRealtime(familyId)
  const router = useRouter()
  const cook = (recipeId: string) => router.push(`/device/recipes?recipe=${recipeId}&from=meals`)

  const weekStart = useMemo(() => startOfWeek(new Date()), [])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const todayISO = isoDate(new Date())

  const { data: meals = [], isLoading } = useMealPlans(
    familyId,
    isoDate(weekStart),
    isoDate(addDays(weekStart, 6)),
  )

  const byCell = useMemo(() => {
    const map = new Map<string, MealPlanOut[]>()
    for (const m of meals) {
      const key = `${m.date}|${m.slot}`
      map.set(key, [...(map.get(key) ?? []), m])
    }
    return map
  }, [meals])

  const tonight = byCell.get(`${todayISO}|dinner`) ?? []

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b px-5 py-3.5">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <UtensilsCrossedIcon className="size-6" />
        </span>
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Meals this week</h1>
          <p className="text-muted-foreground text-sm">What&apos;s for breakfast, lunch &amp; dinner</p>
        </div>
      </div>

      <div className="thin-scrollbar flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="text-muted-foreground flex h-full items-center justify-center gap-2">
            <Loader2Icon className="size-5 animate-spin" />
            Loading meals…
          </div>
        ) : (
          <div className="flex flex-col gap-4">
          {/* Tonight: the one thing you want from this screen at 5pm. */}
          <section className="bg-primary/10 ring-primary/30 flex flex-wrap items-center gap-4 rounded-3xl p-5 ring-2">
            <div className="min-w-0 flex-1">
              <p className="text-primary text-sm font-semibold tracking-wide uppercase">Tonight&apos;s dinner</p>
              {tonight.length === 0 ? (
                <p className="text-muted-foreground mt-1 text-2xl font-medium">Nothing planned yet</p>
              ) : (
                tonight.map((meal) => (
                  <div key={meal.id} className="mt-1 flex flex-wrap items-center gap-4">
                    <p className="font-heading text-3xl font-semibold tracking-tight">
                      {meal.display_title}
                    </p>
                    {meal.recipe_id && (
                      <button
                        type="button"
                        onClick={() => cook(meal.recipe_id!)}
                        className="bg-primary text-primary-foreground flex h-14 items-center gap-2 rounded-2xl px-6 text-xl font-semibold shadow-sm"
                      >
                        <ChefHatIcon className="size-6" /> Cook this
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
            {days.map((day) => {
              const dayISO = isoDate(day)
              const isToday = dayISO === todayISO
              return (
                <div
                  key={dayISO}
                  className={cn(
                    "bg-card ring-foreground/5 flex flex-col gap-2 rounded-2xl p-3 shadow-sm ring-1",
                    isToday && "ring-primary/50 ring-2",
                  )}
                >
                  <div className="flex items-baseline justify-between">
                    <span className={cn("font-heading font-semibold", isToday && "text-primary")}>
                      {day.toLocaleDateString(undefined, { weekday: "short" })}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {day.toLocaleDateString(undefined, { day: "numeric" })}
                    </span>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    {MEAL_SLOTS.map((slot) => {
                      const cellMeals = byCell.get(`${dayISO}|${slot}`) ?? []
                      if (cellMeals.length === 0) return null
                      return (
                        <div key={slot}>
                          <p className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wide">
                            {SLOT_LABELS[slot]}
                          </p>
                          {cellMeals.map((meal) =>
                            meal.recipe_id ? (
                              // A planned recipe opens straight into the cook view.
                              <button
                                key={meal.id}
                                type="button"
                                onClick={() => cook(meal.recipe_id!)}
                                className="text-primary block py-0.5 text-left text-sm leading-snug font-medium underline-offset-2 hover:underline"
                              >
                                {meal.display_title}
                              </button>
                            ) : (
                              <p key={meal.id} className="text-sm leading-snug font-medium">
                                {meal.display_title}
                              </p>
                            ),
                          )}
                        </div>
                      )
                    })}
                    {MEAL_SLOTS.every((slot) => (byCell.get(`${dayISO}|${slot}`) ?? []).length === 0) && (
                      <p className="text-muted-foreground/60 py-2 text-center text-xs">No meals</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          </div>
        )}
      </div>
    </div>
  )
}
