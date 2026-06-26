"use client"

import { useState } from "react"
import { ArrowLeftIcon, BookOpenIcon, Loader2Icon } from "lucide-react"

import { useRealtime } from "@/hooks/use-realtime"
import { useRecipes } from "@/hooks/use-meals"
import { RecipeContent, metaSummary } from "@/components/meals/recipe-content"
import type { RecipeOut } from "@/lib/types/meal"

/**
 * The device "recipes" surface: a glanceable, touch-friendly library. Tap a recipe to read its
 * ingredients and numbered steps full-screen. Read-only — adding/editing happens in the app.
 */
export function RecipeBoard({ familyId }: { familyId: string }) {
  useRealtime(familyId)
  const { data: recipes = [], isLoading } = useRecipes(familyId)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Look the selection up live so realtime edits/deletes don't leave a stale reader open.
  const selected = recipes.find((r) => r.id === selectedId) ?? null

  if (selected) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b px-5 py-3.5">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            aria-label="Back to recipes"
            className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors"
          >
            <ArrowLeftIcon className="size-6" />
          </button>
          <div className="min-w-0">
            <h1 className="font-heading truncate text-2xl font-semibold tracking-tight">
              {selected.name}
            </h1>
            <p className="text-muted-foreground text-sm">{metaSummary(selected)}</p>
          </div>
        </div>
        <div className="thin-scrollbar flex-1 overflow-auto p-5">
          <div className="mx-auto max-w-2xl">
            <RecipeContent recipe={selected} />
          </div>
        </div>
      </div>
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
          <p className="text-muted-foreground text-sm">Tap a recipe to see ingredients &amp; steps</p>
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {recipes.map((recipe) => (
              <RecipeTile key={recipe.id} recipe={recipe} onOpen={() => setSelectedId(recipe.id)} />
            ))}
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
      className="bg-card ring-foreground/5 hover:ring-primary/40 focus-visible:ring-ring flex flex-col overflow-hidden rounded-2xl text-left shadow-sm ring-1 transition-shadow outline-none hover:shadow-md focus-visible:ring-2"
    >
      {recipe.image_url && (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary external recipe URL; next/image would need per-host config
        <img src={recipe.image_url} alt="" className="h-28 w-full object-cover" />
      )}
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="leading-tight font-semibold">{recipe.name}</p>
        <p className="text-muted-foreground text-xs">{metaSummary(recipe)}</p>
        {recipe.tags.length > 0 && (
          <p className="text-muted-foreground/80 mt-auto truncate pt-1 text-xs">
            {recipe.tags.slice(0, 3).join(" · ")}
          </p>
        )}
      </div>
    </button>
  )
}
