"use client"

import { use, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  BookOpenIcon,
  CalendarPlusIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MoreVerticalIcon,
  PencilIcon,
  PlusIcon,
  ShoppingCartIcon,
  SparklesIcon,
  Trash2Icon,
  UtensilsCrossedIcon,
} from "lucide-react"

import { useApi } from "@/hooks/use-api"
import { useRealtime } from "@/hooks/use-realtime"
import {
  useAggregateGrocery,
  useCreateRecipe,
  useDeleteMeal,
  useDeleteRecipe,
  useMealPlans,
  useMealToCalendar,
  useRecipes,
  useUpdateRecipe,
} from "@/hooks/use-meals"
import { AddMealDialog } from "@/components/meals/add-meal-dialog"
import { GroceryBuildDialog } from "@/components/meals/grocery-build-dialog"
import { RecipeImportDialog } from "@/components/meals/recipe-import-dialog"
import { RecipeDetailSheet } from "@/components/meals/recipe-detail-sheet"
import {
  RecipeSheet,
  type RecipeFormValues,
  toRecipePayload,
} from "@/components/meals/recipe-sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import {
  MEAL_SLOTS,
  type AggregatedLine,
  type MealPlanOut,
  type MealSlot,
  type RecipeOut,
} from "@/lib/types/meal"

interface MembershipResponse {
  id: string
  family_id: string
  role: "owner" | "adult" | "child" | "viewer"
}

const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
}

// ── Date helpers (local time; ISO is YYYY-MM-DD) ───────────────────────────────

function startOfWeek(d: Date): Date {
  const x = new Date(d)
  const mondayIndex = (x.getDay() + 6) % 7 // Mon=0 … Sun=6
  x.setDate(x.getDate() - mondayIndex)
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

export default function MealsPage({
  params,
}: {
  params: Promise<{ familyId: string }>
}) {
  const { familyId } = use(params)
  const api = useApi()
  useRealtime(familyId)

  const { data: memberships = [] } = useQuery({
    queryKey: ["me", "memberships"],
    queryFn: () => api.get<MembershipResponse[]>("/me/memberships"),
  })
  const role = memberships.find((m) => m.family_id === familyId)?.role
  const canManage = role === "owner" || role === "adult"

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  )
  const weekStartISO = isoDate(weekStart)
  const weekEndISO = isoDate(addDays(weekStart, 6))
  const todayISO = isoDate(new Date())

  const { data: meals = [], isLoading: mealsLoading } = useMealPlans(
    familyId,
    weekStartISO,
    weekEndISO
  )
  const { data: recipes = [], isLoading: recipesLoading } = useRecipes(familyId)

  const aggregate = useAggregateGrocery(familyId)

  // Group meals by "date|slot" for quick lookup in the grid.
  const byCell = useMemo(() => {
    const map = new Map<string, MealPlanOut[]>()
    for (const m of meals) {
      const key = `${m.date}|${m.slot}`
      map.set(key, [...(map.get(key) ?? []), m])
    }
    return map
  }, [meals])

  const [addCell, setAddCell] = useState<{
    date: string
    slot: MealSlot
    label: string
  } | null>(null)
  const [recipeSheet, setRecipeSheet] = useState<{
    open: boolean
    editing?: RecipeOut
  }>({ open: false })
  const [detail, setDetail] = useState<{ open: boolean; recipe?: RecipeOut }>({
    open: false,
  })
  const [importOpen, setImportOpen] = useState(false)
  const [build, setBuild] = useState<{
    open: boolean
    lines: AggregatedLine[]
    name: string
  }>({
    open: false,
    lines: [],
    name: "",
  })

  const weekLabel = `${weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${addDays(
    weekStart,
    6
  ).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`

  function openBuild(lines: AggregatedLine[], name: string) {
    if (lines.length === 0) {
      toast.info("No recipe ingredients to add — plan some recipes first.")
      return
    }
    setBuild({ open: true, lines, name })
  }

  function buildWeekGroceries() {
    aggregate.mutate(
      { from_date: weekStartISO, to_date: weekEndISO },
      {
        onSuccess: (lines) => openBuild(lines, `Groceries (${weekLabel})`),
        onError: () =>
          toast.error("Couldn't aggregate this week's ingredients."),
      }
    )
  }

  function buildRecipeGroceries(recipe: RecipeOut) {
    aggregate.mutate(
      { recipe_ids: [recipe.id] },
      {
        onSuccess: (lines) => openBuild(lines, `${recipe.name} groceries`),
        onError: () => toast.error("Couldn't aggregate this recipe."),
      }
    )
  }

  return (
    <div className="thin-scrollbar mx-auto flex w-full max-w-3xl flex-col gap-5 overflow-y-auto p-4 sm:p-6 [&>*]:shrink-0">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold tracking-tight">
          Meals &amp; recipes
        </h1>
        <p className="text-sm text-muted-foreground">
          Plan the week, save recipes, and turn them into a grocery list in a
          couple taps.
        </p>
      </header>

      <Tabs defaultValue="week" className="gap-5">
        <TabsList>
          <TabsTrigger value="week" className="gap-1.5">
            <UtensilsCrossedIcon className="size-4" /> This week
          </TabsTrigger>
          <TabsTrigger value="recipes" className="gap-1.5">
            <BookOpenIcon className="size-4" /> Recipes
          </TabsTrigger>
        </TabsList>

        {/* ── Weekly planner ─────────────────────────────────────────────── */}
        <TabsContent value="week" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Previous week"
              onClick={() => setWeekStart((w) => addDays(w, -7))}
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setWeekStart(startOfWeek(new Date()))}
            >
              This week
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Next week"
              onClick={() => setWeekStart((w) => addDays(w, 7))}
            >
              <ChevronRightIcon />
            </Button>
            <span className="ml-1 text-sm font-medium text-muted-foreground">
              {weekLabel}
            </span>
            {canManage && (
              <Button
                size="sm"
                className="ml-auto"
                onClick={buildWeekGroceries}
                disabled={aggregate.isPending}
              >
                <ShoppingCartIcon /> Build grocery list
              </Button>
            )}
          </div>

          {mealsLoading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-32 w-full rounded-2xl" />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {days.map((day) => {
                const dayISO = isoDate(day)
                const isToday = dayISO === todayISO
                return (
                  <div
                    key={dayISO}
                    className={cn(
                      "rounded-2xl bg-card p-3 shadow-sm ring-1 ring-foreground/5",
                      isToday && "ring-2 ring-primary/40"
                    )}
                  >
                    <div className="mb-2 flex items-baseline gap-2 px-1">
                      <span className="font-heading font-semibold">
                        {day.toLocaleDateString(undefined, { weekday: "long" })}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {day.toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      {isToday && (
                        <Badge variant="secondary" className="ml-auto">
                          Today
                        </Badge>
                      )}
                    </div>

                    <div className="flex flex-col divide-y">
                      {MEAL_SLOTS.map((slot) => {
                        const cellMeals = byCell.get(`${dayISO}|${slot}`) ?? []
                        return (
                          <div
                            key={slot}
                            className="flex items-center gap-2 py-1.5"
                          >
                            <span className="w-20 shrink-0 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                              {SLOT_LABELS[slot]}
                            </span>
                            <div className="flex flex-1 flex-wrap items-center gap-1.5">
                              {cellMeals.map((meal) => (
                                <MealChip
                                  key={meal.id}
                                  familyId={familyId}
                                  meal={meal}
                                  canManage={canManage}
                                />
                              ))}
                              {canManage && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setAddCell({
                                      date: dayISO,
                                      slot,
                                      label: day.toLocaleDateString(undefined, {
                                        weekday: "short",
                                        month: "short",
                                        day: "numeric",
                                      }),
                                    })
                                  }
                                  aria-label={`Add ${SLOT_LABELS[slot]} for ${dayISO}`}
                                  className="flex size-6 items-center justify-center rounded-full border border-dashed text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                                >
                                  <PlusIcon className="size-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Recipe library ─────────────────────────────────────────────── */}
        <TabsContent value="recipes" className="flex flex-col gap-4">
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setRecipeSheet({ open: true })}>
                <PlusIcon /> New recipe
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setImportOpen(true)}
              >
                <SparklesIcon /> Add with AI
              </Button>
            </div>
          )}

          {recipesLoading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-28 w-full rounded-2xl" />
              ))}
            </div>
          ) : recipes.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed py-12 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <BookOpenIcon className="size-6" />
              </div>
              <div>
                <p className="font-medium">No recipes yet</p>
                <p className="text-sm text-muted-foreground">
                  {canManage
                    ? "Add a recipe with structured ingredients."
                    : "Nothing saved yet."}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {recipes.map((recipe) => (
                <RecipeCard
                  key={recipe.id}
                  recipe={recipe}
                  canManage={canManage}
                  onOpen={() => setDetail({ open: true, recipe })}
                  onEdit={() => setRecipeSheet({ open: true, editing: recipe })}
                  onAddToGroceries={() => buildRecipeGroceries(recipe)}
                  aggregating={aggregate.isPending}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <AddMealDialog
        open={!!addCell}
        onClose={() => setAddCell(null)}
        familyId={familyId}
        date={addCell?.date ?? null}
        slot={addCell?.slot ?? null}
        dateLabel={addCell?.label ?? ""}
        recipes={recipes}
      />

      <RecipeSheetContainer
        familyId={familyId}
        state={recipeSheet}
        onClose={() => setRecipeSheet({ open: false })}
      />

      <RecipeDetailSheet
        open={detail.open}
        onClose={() => setDetail((d) => ({ ...d, open: false }))}
        recipe={detail.recipe ?? null}
        canManage={canManage}
        onEdit={() => {
          const recipe = detail.recipe
          setDetail((d) => ({ ...d, open: false }))
          if (recipe) setRecipeSheet({ open: true, editing: recipe })
        }}
        onAddToGroceries={() => {
          if (detail.recipe) buildRecipeGroceries(detail.recipe)
        }}
        aggregating={aggregate.isPending}
      />

      <RecipeImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        familyId={familyId}
      />

      <GroceryBuildDialog
        open={build.open}
        onClose={() => setBuild((b) => ({ ...b, open: false }))}
        familyId={familyId}
        lines={build.lines}
        defaultListName={build.name}
      />
    </div>
  )
}

// ── Meal chip ───────────────────────────────────────────────────────────────

function MealChip({
  familyId,
  meal,
  canManage,
}: {
  familyId: string
  meal: MealPlanOut
  canManage: boolean
}) {
  const deleteMeal = useDeleteMeal(familyId)
  const toCalendar = useMealToCalendar(familyId)
  const onCalendar = !!meal.calendar_event_id

  const chip = (
    <span
      className={cn(
        "flex items-center gap-1 rounded-full px-2.5 py-1 text-sm",
        meal.recipe ? "bg-primary/10 text-primary" : "bg-muted text-foreground"
      )}
    >
      {onCalendar && <CalendarPlusIcon className="size-3 opacity-70" />}
      {meal.display_title}
    </span>
  )

  if (!canManage) return chip

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group flex items-center"
          aria-label={`${meal.display_title} options`}
        >
          {chip}
          <MoreVerticalIcon className="-ml-0.5 size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem
          onClick={() =>
            toCalendar.mutate(meal.id, {
              onSuccess: () => toast.success("Added to the calendar"),
              onError: () => toast.error("Couldn't add to the calendar."),
            })
          }
        >
          <CalendarPlusIcon />{" "}
          {onCalendar ? "Update on calendar" : "Add to calendar"}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onClick={() =>
            deleteMeal.mutate(meal.id, {
              onError: () => toast.error("Couldn't remove the meal."),
            })
          }
        >
          <Trash2Icon /> Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ── Recipe card ───────────────────────────────────────────────────────────────

function RecipeCard({
  recipe,
  canManage,
  onOpen,
  onEdit,
  onAddToGroceries,
  aggregating,
}: {
  recipe: RecipeOut
  canManage: boolean
  onOpen: () => void
  onEdit: () => void
  onAddToGroceries: () => void
  aggregating: boolean
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`View ${recipe.name}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        // Only the card itself — let the nested buttons handle their own keys.
        if (
          (e.key === "Enter" || e.key === " ") &&
          e.target === e.currentTarget
        ) {
          e.preventDefault()
          onOpen()
        }
      }}
      className="flex cursor-pointer flex-col gap-2 rounded-2xl bg-card p-3 shadow-sm ring-1 ring-foreground/5 transition-shadow outline-none hover:shadow-md hover:ring-primary/30 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start gap-2">
        {recipe.image_url && (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary external recipe URL; next/image would need per-host config
          <img
            src={recipe.image_url}
            alt=""
            className="size-12 shrink-0 rounded-xl object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate leading-tight font-semibold">{recipe.name}</p>
          <p className="text-xs text-muted-foreground">
            {recipe.ingredients.length} ingredient
            {recipe.ingredients.length === 1 ? "" : "s"}
            {recipe.servings ? ` · serves ${recipe.servings}` : ""}
            {(() => {
              const total =
                (recipe.prep_minutes ?? 0) + (recipe.cook_minutes ?? 0)
              return total > 0 ? ` · ${total} min` : ""
            })()}
          </p>
        </div>
        {canManage && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit ${recipe.name}`}
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <PencilIcon />
          </Button>
        )}
      </div>

      {recipe.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {recipe.tags.slice(0, 4).map((t) => (
            <Badge key={t} variant="secondary" className="text-[10px]">
              {t}
            </Badge>
          ))}
        </div>
      )}

      {canManage && (
        <Button
          variant="outline"
          size="sm"
          className="mt-auto"
          onClick={(e) => {
            e.stopPropagation()
            onAddToGroceries()
          }}
          disabled={aggregating || recipe.ingredients.length === 0}
        >
          <ShoppingCartIcon /> Add to groceries
        </Button>
      )}
    </div>
  )
}

// ── Recipe sheet wiring (create + edit/delete) ────────────────────────────────

function RecipeSheetContainer({
  familyId,
  state,
  onClose,
}: {
  familyId: string
  state: { open: boolean; editing?: RecipeOut }
  onClose: () => void
}) {
  const createRecipe = useCreateRecipe(familyId)
  const updateRecipe = useUpdateRecipe(familyId)
  const deleteRecipe = useDeleteRecipe(familyId)
  const editing = state.editing

  function handleSubmit(values: RecipeFormValues) {
    const payload = toRecipePayload(values)
    if (editing) {
      updateRecipe.mutate(
        { recipeId: editing.id, data: payload },
        {
          onSuccess: () => {
            onClose()
            toast.success("Recipe saved")
          },
          onError: () =>
            toast.error("Couldn't save the recipe. Please try again."),
        }
      )
    } else {
      createRecipe.mutate(payload, {
        onSuccess: () => {
          onClose()
          toast.success("Recipe created")
        },
        onError: () =>
          toast.error("Couldn't create the recipe. Please try again."),
      })
    }
  }

  function handleDelete() {
    if (!editing) return
    deleteRecipe.mutate(editing.id, {
      onSuccess: () => {
        onClose()
        toast.success("Recipe deleted")
      },
      onError: () => toast.error("Couldn't delete the recipe."),
    })
  }

  return (
    <RecipeSheet
      open={state.open}
      onClose={onClose}
      onSubmit={handleSubmit}
      onDelete={editing ? handleDelete : undefined}
      isPending={createRecipe.isPending || updateRecipe.isPending}
      isDeleting={deleteRecipe.isPending}
      editing={editing}
    />
  )
}
