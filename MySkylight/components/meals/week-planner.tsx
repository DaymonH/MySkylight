"use client"

import { mediaUrl } from "@/lib/media"
import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  CalendarPlusIcon,
  ChefHatIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  MoreVerticalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  ShoppingBagIcon,
  ShoppingCartIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react"

import {
  useAutofillMeals,
  useCopyMeals,
  useDeleteMeal,
  useMealPlans,
  useMealToCalendar,
  useUpdateMeal,
} from "@/hooks/use-meals"
import { AddMealDialog } from "@/components/meals/add-meal-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { MEAL_SLOTS, type MealPlanOut, type MealSlot, type RecipeOut } from "@/lib/types/meal"

const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
}

// ── Date helpers (local time; ISO is YYYY-MM-DD) ───────────────────────────────

function startOfWeek(d: Date): Date {
  const x = new Date(d)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)) // Mon=0 … Sun=6
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
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/**
 * The weekly meal planner. Dinner is the one slot always shown; breakfast / lunch / snack
 * appear once they have something in them (or from a "+ Breakfast" chip), which keeps a
 * week to about two screens. Opens scrolled to today, with a day strip to jump around.
 */
export function WeekPlanner({
  familyId,
  canManage,
  recipes,
  onBuildGroceries,
  building,
}: {
  familyId: string
  canManage: boolean
  recipes: RecipeOut[]
  onBuildGroceries: (fromISO: string, toISO: string, label: string) => void
  building: boolean
}) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const weekStartISO = isoDate(weekStart)
  const weekEndISO = isoDate(addDays(weekStart, 6))
  const todayISO = isoDate(new Date())
  const isCurrentWeek = todayISO >= weekStartISO && todayISO <= weekEndISO

  // On the current week the list carries on into next week, so fetch both.
  const nextStart = addDays(weekStart, 7)
  const nextStartISO = isoDate(nextStart)
  const nextEndISO = isoDate(addDays(weekStart, 13))
  const nextDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(nextStart, i)), [nextStart])
  const { data: meals = [], isLoading } = useMealPlans(
    familyId,
    weekStartISO,
    isCurrentWeek ? nextEndISO : weekEndISO,
  )
  const copyMeals = useCopyMeals(familyId)
  const autofill = useAutofillMeals(familyId)

  const byCell = useMemo(() => {
    const map = new Map<string, MealPlanOut[]>()
    for (const m of meals) {
      const key = `${m.date}|${m.slot}`
      map.set(key, [...(map.get(key) ?? []), m])
    }
    return map
  }, [meals])
  const plannedDays = useMemo(() => new Set(meals.map((m) => m.date)), [meals])

  // This week, days that are already over fold away so today is the first thing you see.
  const [expandedWeek, setExpandedWeek] = useState<string | null>(null)
  const showPast = !isCurrentWeek || expandedWeek === weekStartISO
  const pastDays = isCurrentWeek ? days.filter((d) => isoDate(d) < todayISO) : []
  const visibleDays = showPast ? days : days.filter((d) => isoDate(d) >= todayISO)
  const pastMealCount = meals.filter((m) => m.date < todayISO).length

  const [addCell, setAddCell] = useState<{ date: string; slot: MealSlot; label: string } | null>(null)
  const [editing, setEditing] = useState<MealPlanOut | null>(null)

  const weekLabel = `${weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${addDays(
    weekStart,
    6,
  ).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`

  const nextLabel = `${nextStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${addDays(
    nextStart,
    6,
  ).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`

  // Land on today when this week opens (the grid is long on a phone). Once per week shown.
  const scrolledFor = useRef<string | null>(null)
  useEffect(() => {
    if (isLoading || !isCurrentWeek || scrolledFor.current === weekStartISO) return
    scrolledFor.current = weekStartISO
    document.getElementById(`meal-day-${todayISO}`)?.scrollIntoView({ block: "start" })
  }, [isLoading, isCurrentWeek, weekStartISO, todayISO])

  function jumpTo(iso: string) {
    const scroll = () =>
      document.getElementById(`meal-day-${iso}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
    if (!showPast && iso < todayISO) {
      // A folded-away day: open the earlier days first, then scroll once they've rendered.
      setExpandedWeek(weekStartISO)
      requestAnimationFrame(() => requestAnimationFrame(scroll))
    } else {
      scroll()
    }
  }

  function copyWeek(fromStart: Date, toStart: Date, from: "last" | "this") {
    copyMeals.mutate(
      { from_date: isoDate(fromStart), to_date: isoDate(toStart), days: 7 },
      {
        onSuccess: (created) =>
          created.length > 0
            ? toast.success(
                `Copied ${plural(created.length, "meal")} from ${from === "last" ? "last" : "this"} week`,
              )
            : toast.info(
                from === "last"
                  ? "Nothing to copy — last week is empty, or this week is already planned."
                  : "Nothing to copy — this week is empty, or next week is already planned.",
              ),
        onError: () => toast.error("Couldn't copy the meals."),
      },
    )
  }

  function fillDinners(fromISO: string, toISO: string) {
    if (toISO < todayISO) {
      toast.info("That week is already over.")
      return
    }
    autofill.mutate(
      { from_date: fromISO > todayISO ? fromISO : todayISO, to_date: toISO, slots: ["dinner"] },
      {
        onSuccess: (created) =>
          created.length > 0
            ? toast.success(`Filled ${plural(created.length, "dinner")} with recipes you haven't made lately`)
            : toast.info(
                recipes.length === 0
                  ? "Add some recipes first."
                  : "No fresh recipes to suggest — everything's been planned or made recently.",
              ),
        onError: () => toast.error("Couldn't fill the week."),
      },
    )
  }

  function openAdd(date: Date, slot: MealSlot) {
    setAddCell({
      date: isoDate(date),
      slot,
      label: date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Week navigation + the main action */}
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Previous week"
          onClick={() => setWeekStart((w) => addDays(w, -7))}
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Next week"
          onClick={() => setWeekStart((w) => addDays(w, 7))}
        >
          <ChevronRightIcon />
        </Button>
        <button
          type="button"
          disabled={isCurrentWeek}
          onClick={() => setWeekStart(startOfWeek(new Date()))}
          className="min-w-0 flex-1 truncate text-left text-sm font-medium enabled:hover:underline"
          aria-label={isCurrentWeek ? "This week" : "Back to this week"}
        >
          {isCurrentWeek ? "This week" : weekLabel}
          {isCurrentWeek && <span className="text-muted-foreground font-normal"> · {weekLabel}</span>}
        </button>
        {canManage && (
          <>
            <Button
              size="sm"
              onClick={() => onBuildGroceries(weekStartISO, weekEndISO, `Groceries (${weekLabel})`)}
              disabled={building}
              aria-label="Build grocery list"
            >
              <ShoppingCartIcon />
              <span className="hidden sm:inline">Build grocery list</span>
              <span className="sm:hidden">Groceries</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon-sm" aria-label="Planning options">
                  <MoreVerticalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem
                  onSelect={() => copyWeek(addDays(weekStart, -7), weekStart, "last")}
                  disabled={copyMeals.isPending}
                >
                  <CopyIcon /> Copy last week&apos;s meals
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => fillDinners(weekStartISO, weekEndISO)}
                  disabled={autofill.isPending}
                >
                  <SparklesIcon /> Fill empty dinners for me
                </DropdownMenuItem>
                {isCurrentWeek && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-muted-foreground text-xs">Next week</DropdownMenuLabel>
                    <DropdownMenuItem
                      onSelect={() => copyWeek(weekStart, nextStart, "this")}
                      disabled={copyMeals.isPending}
                    >
                      <CopyIcon /> Copy this week&apos;s meals
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => fillDinners(nextStartISO, isoDate(addDays(nextStart, 6)))}
                      disabled={autofill.isPending}
                    >
                      <SparklesIcon /> Fill empty dinners
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        onBuildGroceries(nextStartISO, isoDate(addDays(nextStart, 6)), `Groceries (${nextLabel})`)
                      }
                      disabled={building}
                    >
                      <ShoppingCartIcon /> Build grocery list
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      {/* Day strip: sticky, jumps to a day */}
      <nav
        aria-label="Jump to a day"
        // `-top-*` cancels the page's own padding, which sticky would otherwise keep as a gap
        // (where scrolled content showed through above the strip); `pt-*` puts it back inside.
        className="bg-background/95 sticky -top-4 z-10 -mx-4 flex justify-between gap-1 border-b px-4 pt-6 pb-2 backdrop-blur sm:-top-6 sm:-mx-6 sm:px-6 sm:pt-8"
      >
        {days.map((d) => {
          const iso = isoDate(d)
          const isToday = iso === todayISO
          return (
            <button
              key={iso}
              type="button"
              onClick={() => jumpTo(iso)}
              aria-label={d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl py-1 text-xs transition-colors",
                isToday ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              <span className="font-medium">{d.toLocaleDateString(undefined, { weekday: "narrow" })}</span>
              <span className="text-sm font-semibold tabular-nums">{d.getDate()}</span>
              <span
                className={cn(
                  "size-1 rounded-full",
                  plannedDays.has(iso) ? (isToday ? "bg-primary-foreground" : "bg-primary") : "bg-transparent",
                )}
              />
            </button>
          )
        })}
      </nav>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {isCurrentWeek && !showPast && pastDays.length > 0 && (
            <button
              type="button"
              onClick={() => setExpandedWeek(weekStartISO)}
              className="text-muted-foreground hover:text-foreground hover:bg-muted/50 flex items-center justify-between rounded-2xl border border-dashed px-4 py-3 text-sm transition-colors"
            >
              <span>
                Earlier this week · {pastDays.length} {pastDays.length === 1 ? "day" : "days"}
              </span>
              <span className="text-xs">
                {pastMealCount > 0 ? `${pastMealCount} planned · ` : ""}Show
              </span>
            </button>
          )}
          {isCurrentWeek && showPast && pastDays.length > 0 && expandedWeek === weekStartISO && (
            <button
              type="button"
              onClick={() => setExpandedWeek(null)}
              className="text-muted-foreground hover:text-foreground self-start px-1 text-xs"
            >
              Hide earlier days
            </button>
          )}
          {[...visibleDays, ...(isCurrentWeek ? nextDays : [])].map((day) => {
            const iso = isoDate(day)
            const isToday = iso === todayISO
            const filled = (slot: MealSlot) => byCell.get(`${iso}|${slot}`) ?? []
            const shownSlots = MEAL_SLOTS.filter((s) => s === "dinner" || filled(s).length > 0)
            const hiddenSlots = MEAL_SLOTS.filter((s) => !shownSlots.includes(s))
            return (
              <Fragment key={iso}>
              {isCurrentWeek && iso === nextStartISO && (
                <div className="mt-2 flex items-baseline justify-between px-1">
                  <h2 className="font-heading text-muted-foreground text-sm font-semibold tracking-wide uppercase">
                    Next week
                  </h2>
                  <span className="text-muted-foreground text-xs">{nextLabel}</span>
                </div>
              )}
              <section
                id={`meal-day-${iso}`}
                className={cn(
                  "bg-card ring-foreground/5 scroll-mt-24 rounded-2xl p-3 shadow-sm ring-1",
                  isToday && "ring-primary/40 ring-2",
                )}
              >
                <div className="mb-2 flex items-baseline gap-2 px-1">
                  <h3 className="font-heading font-semibold">
                    {day.toLocaleDateString(undefined, { weekday: "long" })}
                  </h3>
                  <span className="text-muted-foreground text-xs">
                    {day.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                  {isToday && (
                    <Badge variant="secondary" className="ml-auto">
                      Today
                    </Badge>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  {shownSlots.map((slot) => {
                    const cell = filled(slot)
                    return (
                      <div key={slot} className="flex flex-col gap-1.5">
                        {cell.map((meal) => (
                          <MealRow
                            key={meal.id}
                            familyId={familyId}
                            meal={meal}
                            canManage={canManage}
                            showSlot={slot !== "dinner"}
                            onEdit={() => setEditing(meal)}
                          />
                        ))}
                        {cell.length === 0 && canManage && (
                          <button
                            type="button"
                            onClick={() => openAdd(day, slot)}
                            aria-label={`Add ${SLOT_LABELS[slot]} for ${iso}`}
                            className="text-muted-foreground hover:border-primary hover:text-primary flex items-center gap-2 rounded-xl border border-dashed px-3 py-3 text-sm transition-colors"
                          >
                            <PlusIcon className="size-4" /> Add {SLOT_LABELS[slot].toLowerCase()}
                          </button>
                        )}
                        {cell.length === 0 && !canManage && (
                          <p className="text-muted-foreground px-1 py-1 text-sm">Nothing planned</p>
                        )}
                        {cell.length > 0 && canManage && slot === "dinner" && (
                          <button
                            type="button"
                            onClick={() => openAdd(day, slot)}
                            className="text-muted-foreground hover:text-primary self-start px-1 text-xs"
                          >
                            + add another
                          </button>
                        )}
                      </div>
                    )
                  })}
                  {canManage && hiddenSlots.length > 0 && (
                    <div className="flex flex-wrap gap-x-3 px-1 pt-0.5">
                      {hiddenSlots.map((slot) => (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => openAdd(day, slot)}
                          className="text-muted-foreground hover:text-primary text-xs"
                        >
                          + {SLOT_LABELS[slot]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </section>
              </Fragment>
            )
          })}
        </div>
      )}

      <AddMealDialog
        open={!!addCell}
        onClose={() => setAddCell(null)}
        familyId={familyId}
        date={addCell?.date ?? null}
        slot={addCell?.slot ?? null}
        dateLabel={addCell?.label ?? ""}
        recipes={recipes}
      />
      <MealEditDialog
        familyId={familyId}
        meal={editing}
        onClose={() => setEditing(null)}
      />
    </div>
  )
}

// ── One planned meal ───────────────────────────────────────────────────────────

function MealRow({
  familyId,
  meal,
  canManage,
  showSlot,
  onEdit,
}: {
  familyId: string
  meal: MealPlanOut
  canManage: boolean
  showSlot: boolean
  onEdit: () => void
}) {
  const deleteMeal = useDeleteMeal(familyId)
  const toCalendar = useMealToCalendar(familyId)
  const onCalendar = !!meal.calendar_event_id

  const Icon =
    meal.kind === "leftovers" ? RefreshCwIcon : meal.kind === "eating_out" ? ShoppingBagIcon : ChefHatIcon
  const body = (
    <>
      {meal.recipe?.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary external recipe URL; next/image would need per-host config
        <img src={mediaUrl(meal.recipe.image_url)} alt="" className="size-11 shrink-0 rounded-lg object-cover" />
      ) : (
        <span
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-lg",
            meal.recipe ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-5" />
        </span>
      )}
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate font-medium">{meal.display_title}</span>
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
          {showSlot && <span>{SLOT_LABELS[meal.slot]}</span>}
          {meal.servings && <span>for {meal.servings}</span>}
          {onCalendar && (
            <span className="inline-flex items-center gap-0.5">
              <CalendarPlusIcon className="size-3" /> On calendar
            </span>
          )}
        </span>
      </span>
    </>
  )
  const rowClass = "flex w-full items-center gap-3 rounded-xl bg-muted/40 p-2"

  if (!canManage) return <div className={rowClass}>{body}</div>

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${meal.display_title} options`}
          className={cn(rowClass, "hover:bg-muted/70 transition-colors")}
        >
          {body}
          <MoreVerticalIcon className="text-muted-foreground size-4 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={onEdit}>
          <PencilIcon /> Change day / servings
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            toCalendar.mutate(meal.id, {
              onSuccess: () => toast.success("Added to the calendar"),
              onError: () => toast.error("Couldn't add to the calendar."),
            })
          }
        >
          <CalendarPlusIcon /> {onCalendar ? "Update on calendar" : "Add to calendar"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() =>
            deleteMeal.mutate(meal.id, { onError: () => toast.error("Couldn't remove the meal.") })
          }
        >
          <Trash2Icon /> Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ── Move a meal to another day / slot, or change how many it's for ───────────────

function MealEditDialog({
  familyId,
  meal,
  onClose,
}: {
  familyId: string
  meal: MealPlanOut | null
  onClose: () => void
}) {
  return (
    <Dialog open={!!meal} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {meal && <MealEditForm key={meal.id} familyId={familyId} meal={meal} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function MealEditForm({
  familyId,
  meal,
  onClose,
}: {
  familyId: string
  meal: MealPlanOut
  onClose: () => void
}) {
  const update = useUpdateMeal(familyId)
  const [date, setDate] = useState(meal.date)
  const [slot, setSlot] = useState<MealSlot>(meal.slot)
  const [servings, setServings] = useState(meal.servings ? String(meal.servings) : "")

  function save() {
    const n = parseInt(servings, 10)
    update.mutate(
      {
        mealId: meal.id,
        data: {
          date,
          slot,
          ...(meal.recipe_id ? { servings: n >= 1 ? n : null } : {}),
        },
      },
      {
        onSuccess: () => {
          toast.success("Meal updated")
          onClose()
        },
        onError: () => toast.error("Couldn't update the meal."),
      },
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{meal.display_title}</DialogTitle>
        <DialogDescription>Move it to another day, or change how many it&apos;s for.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="meal-date">Day</Label>
          <Input id="meal-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Meal</Label>
          <Select value={slot} onValueChange={(v) => setSlot(v as MealSlot)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEAL_SLOTS.map((s) => (
                <SelectItem key={s} value={s}>
                  {SLOT_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {meal.recipe_id && (
          <div className="space-y-1.5">
            <Label htmlFor="meal-edit-servings">Cooking for</Label>
            <Input
              id="meal-edit-servings"
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              value={servings}
              onChange={(e) => setServings(e.target.value)}
              placeholder="Uses the recipe's servings"
            />
            <p className="text-muted-foreground text-xs">
              The grocery list scales this meal&apos;s ingredients to match.
            </p>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={save} disabled={update.isPending || !date}>
          Save
        </Button>
      </DialogFooter>
    </>
  )
}
