"use client"

import { useState } from "react"
import {
  ChefHatIcon,
  MinusIcon,
  PencilIcon,
  PlusIcon,
  ShoppingCartIcon,
  StarIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { CookMode } from "@/components/meals/cook-mode"
import { RecipeContent, metaSummary } from "@/components/meals/recipe-content"
import { RecipeStars } from "@/components/meals/recipe-stars"
import { scaleFactor } from "@/lib/recipe-scale"
import { cn } from "@/lib/utils"
import type { RecipeOut } from "@/lib/types/meal"

/** "Made 3 times · last Oct 12" (or "Not made yet"). */
export function usageLabel(r: Pick<RecipeOut, "times_made" | "last_made">): string {
  if (!r.times_made || !r.last_made) return "Not made yet"
  const [y, m, d] = r.last_made.split("-").map(Number)
  const when = new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" })
  return `Made ${r.times_made} time${r.times_made === 1 ? "" : "s"} · last ${when}`
}

/**
 * Read-only view of a saved recipe — opened by tapping a recipe card. Shows ingredients
 * (scalable to any head-count), numbered steps, a ★ favorite + rating, how often it's
 * been cooked, and a Cook button for the big-text stove view. Owner/adult also get
 * "Edit" and "Add to groceries" (which uses the chosen head-count).
 */
export function RecipeDetailSheet({
  open,
  onClose,
  recipe,
  canManage,
  onEdit,
  onAddToGroceries,
  onToggleFavorite,
  onRate,
  aggregating,
}: {
  open: boolean
  onClose: () => void
  recipe: RecipeOut | null
  canManage: boolean
  onEdit: () => void
  onAddToGroceries: (servings: number | null) => void
  onToggleFavorite: () => void
  onRate: (rating: number | null) => void
  aggregating: boolean
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-lg">
        {/* Keyed by recipe so the servings picker resets when a different one opens. */}
        {recipe && (
          <DetailBody
            key={recipe.id}
            recipe={recipe}
            canManage={canManage}
            onEdit={onEdit}
            onAddToGroceries={onAddToGroceries}
            onToggleFavorite={onToggleFavorite}
            onRate={onRate}
            aggregating={aggregating}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function DetailBody({
  recipe,
  canManage,
  onEdit,
  onAddToGroceries,
  onToggleFavorite,
  onRate,
  aggregating,
}: {
  recipe: RecipeOut
  canManage: boolean
  onEdit: () => void
  onAddToGroceries: (servings: number | null) => void
  onToggleFavorite: () => void
  onRate: (rating: number | null) => void
  aggregating: boolean
}) {
  const base = recipe.servings && recipe.servings > 0 ? recipe.servings : null
  const [servings, setServings] = useState<number | null>(base)
  const [cooking, setCooking] = useState(false)
  const scale = scaleFactor(recipe, servings)
  const scaled = base != null && servings != null && servings !== base

  return (
    <>
      <SheetHeader className="border-b pr-14">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-lg">{recipe.name}</SheetTitle>
            <SheetDescription>{metaSummary(recipe)}</SheetDescription>
          </div>
          {canManage && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={recipe.is_favorite ? "Remove from favorites" : "Add to favorites"}
              aria-pressed={recipe.is_favorite}
              onClick={onToggleFavorite}
            >
              <StarIcon
                className={cn(recipe.is_favorite && "fill-amber-400 text-amber-400")}
              />
            </Button>
          )}
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 text-xs">
          {canManage ? (
            <RecipeStars value={recipe.rating} onChange={onRate} />
          ) : (
            recipe.rating && <RecipeStars value={recipe.rating} />
          )}
          <span>{usageLabel(recipe)}</span>
        </div>
      </SheetHeader>

      <div className="thin-scrollbar flex-1 overflow-y-auto p-6">
        {base != null && servings != null && (
          <div className="mb-5 flex items-center justify-between rounded-2xl border px-3 py-2">
            <span className="text-sm font-medium">Cooking for</span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Fewer servings"
                disabled={servings <= 1}
                onClick={() => setServings(servings - 1)}
              >
                <MinusIcon />
              </Button>
              <span className="w-16 text-center text-sm tabular-nums">
                {servings} {servings === 1 ? "serving" : "servings"}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="More servings"
                disabled={servings >= 99}
                onClick={() => setServings(servings + 1)}
              >
                <PlusIcon />
              </Button>
              {scaled && (
                <Button variant="ghost" size="sm" onClick={() => setServings(base)}>
                  Reset
                </Button>
              )}
            </div>
          </div>
        )}
        <RecipeContent recipe={recipe} scale={scale} />
      </div>

      <SheetFooter className="flex-row items-center gap-2 border-t">
        <Button
          type="button"
          variant={canManage ? "outline" : "default"}
          className="flex-1"
          onClick={() => setCooking(true)}
        >
          <ChefHatIcon /> Cook
        </Button>
        {canManage && (
          <>
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => onAddToGroceries(scaled ? servings : null)}
              disabled={aggregating || recipe.ingredients.length === 0}
            >
              <ShoppingCartIcon /> Groceries
            </Button>
            <Button type="button" className="flex-1" onClick={onEdit}>
              <PencilIcon /> Edit
            </Button>
          </>
        )}
      </SheetFooter>

      <CookMode open={cooking} onClose={() => setCooking(false)} recipe={recipe} scale={scale} />
    </>
  )
}
