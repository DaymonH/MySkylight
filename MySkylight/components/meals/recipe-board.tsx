"use client"

import { useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { BookOpenIcon, CalendarCheckIcon, Loader2Icon, StarIcon } from "lucide-react"

import { useRealtime } from "@/hooks/use-realtime"
import { useMealPlans, useRecipes } from "@/hooks/use-meals"
import { KioskCookView } from "@/components/meals/kiosk-cook-view"
import { RecipeStars } from "@/components/meals/recipe-stars"
import { usageLabel } from "@/components/meals/recipe-detail-sheet"
import { metaSummary } from "@/components/meals/recipe-content"
import { cn } from "@/lib/utils"
import type { RecipeOut } from "@/lib/types/meal"

function isoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}

/** Monday → Sunday of the current week, as ISO dates. */
function thisWeek(): { from: string; to: string } {
  const start = new Date()
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return { from: isoDate(start), to: isoDate(end) }
}

/**
 * The device "recipes" surface. The library puts what's planned this week and your favorites
 * first; tapping a recipe opens the cook view (big-type steps, ingredients, timers). The open
 * recipe lives in the URL (`?recipe=<id>`) so the Meals page can link straight to it and the
 * browser's back button works; `from=meals` sends Back there instead of to the library.
 */
export function RecipeBoard({ familyId }: { familyId: string }) {
  useRealtime(familyId)
  const router = useRouter()
  const params = useSearchParams()
  const selectedId = params.get("recipe")
  const cameFromMeals = params.get("from") === "meals"

  const { data: recipes = [], isLoading } = useRecipes(familyId)
  const week = useMemo(() => thisWeek(), [])
  const { data: meals = [] } = useMealPlans(familyId, week.from, week.to)

  const planned = useMemo(() => {
    const ids = new Set(meals.map((m) => m.recipe_id).filter((id): id is string => !!id))
    return recipes.filter((r) => ids.has(r.id))
  }, [meals, recipes])
  const sorted = useMemo(
    () =>
      [...recipes].sort(
        (a, b) => Number(b.is_favorite) - Number(a.is_favorite) || a.name.localeCompare(b.name),
      ),
    [recipes],
  )

  // Look the selection up live so realtime edits/deletes don't leave a stale reader open.
  const selected = recipes.find((r) => r.id === selectedId) ?? null
  const open = (id: string) => router.push(`/device/recipes?recipe=${id}`)

  if (selected) {
    return (
      <KioskCookView
        key={selected.id}
        recipe={selected}
        onBack={() => router.push(cameFromMeals ? "/device/meals" : "/device/recipes")}
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b px-5 py-3.5">
        <span className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-xl shadow-sm">
          <BookOpenIcon className="size-6" />
        </span>
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Recipes</h1>
          <p className="text-muted-foreground text-sm">Tap a recipe to start cooking</p>
        </div>
      </div>

      <div className="thin-scrollbar flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="text-muted-foreground flex h-full items-center justify-center gap-2">
            <Loader2Icon className="size-5 animate-spin" />
            Loading recipes…
          </div>
        ) : recipes.length === 0 ? (
          <div className="text-muted-foreground/70 flex h-full flex-col items-center justify-center gap-3 text-center">
            <BookOpenIcon className="size-10" />
            <p>No recipes yet — add one from the companion app.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {planned.length > 0 && (
              <section>
                <h2 className="font-heading text-muted-foreground mb-2 flex items-center gap-2 text-sm font-semibold tracking-wide uppercase">
                  <CalendarCheckIcon className="size-4" /> Planned this week
                </h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  {planned.map((recipe) => (
                    <RecipeTile key={recipe.id} recipe={recipe} onOpen={() => open(recipe.id)} />
                  ))}
                </div>
              </section>
            )}
            <section>
              {planned.length > 0 && (
                <h2 className="font-heading text-muted-foreground mb-2 text-sm font-semibold tracking-wide uppercase">
                  All recipes
                </h2>
              )}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {sorted.map((recipe) => (
                  <RecipeTile key={recipe.id} recipe={recipe} onOpen={() => open(recipe.id)} />
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

function RecipeTile({ recipe, onOpen }: { recipe: RecipeOut; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="bg-card ring-foreground/5 hover:ring-primary/40 focus-visible:ring-ring relative flex flex-col overflow-hidden rounded-2xl text-left shadow-sm ring-1 transition-shadow outline-none hover:shadow-md focus-visible:ring-2"
    >
      {recipe.is_favorite && (
        <StarIcon
          aria-label="Favorite"
          className={cn(
            "absolute top-2 right-2 size-6 fill-amber-400 text-amber-400 drop-shadow",
          )}
        />
      )}
      {recipe.image_url && (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary external recipe URL; next/image would need per-host config
        <img src={recipe.image_url} alt="" className="h-28 w-full object-cover" />
      )}
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="leading-tight font-semibold">{recipe.name}</p>
        <p className="text-muted-foreground text-xs">{metaSummary(recipe)}</p>
        {recipe.rating && <RecipeStars value={recipe.rating} size="size-3.5" />}
        <p className="text-muted-foreground/80 mt-auto pt-1 text-xs">{usageLabel(recipe)}</p>
      </div>
    </button>
  )
}
