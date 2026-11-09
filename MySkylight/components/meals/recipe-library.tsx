"use client"

import { useMemo, useState } from "react"
import { BookOpenIcon, PencilIcon, SearchIcon, ShoppingCartIcon, StarIcon, XIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RecipeStars } from "@/components/meals/recipe-stars"
import { usageLabel } from "@/components/meals/recipe-detail-sheet"
import { cn } from "@/lib/utils"
import type { RecipeOut } from "@/lib/types/meal"

type Sort = "favorites" | "name" | "recent" | "most" | "rating"

const SORTS: { value: Sort; label: string }[] = [
  { value: "favorites", label: "Favorites first" },
  { value: "name", label: "Name A–Z" },
  { value: "recent", label: "Recently made" },
  { value: "most", label: "Most made" },
  { value: "rating", label: "Top rated" },
]

function sorter(sort: Sort): (a: RecipeOut, b: RecipeOut) => number {
  const byName = (a: RecipeOut, b: RecipeOut) => a.name.localeCompare(b.name)
  switch (sort) {
    case "favorites":
      return (a, b) => Number(b.is_favorite) - Number(a.is_favorite) || byName(a, b)
    case "recent":
      // Never-made recipes sink to the bottom.
      return (a, b) => (b.last_made ?? "").localeCompare(a.last_made ?? "") || byName(a, b)
    case "most":
      return (a, b) => b.times_made - a.times_made || byName(a, b)
    case "rating":
      return (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || byName(a, b)
    default:
      return byName
  }
}

/**
 * The recipe tab: search, ★ / tag filters, sort, and the cards. A recipe matches when
 * its name, tags or any ingredient contains the search text.
 */
export function RecipeLibrary({
  recipes,
  loading,
  canManage,
  onOpen,
  onEdit,
  onAddToGroceries,
  onToggleFavorite,
  aggregating,
}: {
  recipes: RecipeOut[]
  loading: boolean
  canManage: boolean
  onOpen: (r: RecipeOut) => void
  onEdit: (r: RecipeOut) => void
  onAddToGroceries: (r: RecipeOut) => void
  onToggleFavorite: (r: RecipeOut) => void
  aggregating: boolean
}) {
  const [query, setQuery] = useState("")
  const [onlyFavs, setOnlyFavs] = useState(false)
  const [tag, setTag] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>("favorites")

  const allTags = useMemo(
    () => [...new Set(recipes.flatMap((r) => r.tags))].sort((a, b) => a.localeCompare(b)),
    [recipes],
  )

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return recipes
      .filter((r) => {
        if (onlyFavs && !r.is_favorite) return false
        if (tag && !r.tags.includes(tag)) return false
        if (!q) return true
        return (
          r.name.toLowerCase().includes(q) ||
          r.tags.some((t) => t.toLowerCase().includes(q)) ||
          r.ingredients.some((i) => i.name.toLowerCase().includes(q))
        )
      })
      .sort(sorter(sort))
  }, [recipes, query, onlyFavs, tag, sort])

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-2xl" />
        ))}
      </div>
    )
  }
  if (recipes.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed py-12 text-center">
        <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-2xl">
          <BookOpenIcon className="size-6" />
        </div>
        <div>
          <p className="font-medium">No recipes yet</p>
          <p className="text-muted-foreground text-sm">
            {canManage ? "Add a recipe with structured ingredients." : "Nothing saved yet."}
          </p>
        </div>
      </div>
    )
  }

  const filtering = !!query.trim() || onlyFavs || !!tag
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search recipes or ingredients"
            aria-label="Search recipes"
            className="pr-9 pl-9"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 p-1"
            >
              <XIcon className="size-4" />
            </button>
          )}
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
          <SelectTrigger className="w-[9.5rem]" aria-label="Sort recipes">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {(allTags.length > 0 || recipes.some((r) => r.is_favorite)) && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-pressed={onlyFavs}
            onClick={() => setOnlyFavs((v) => !v)}
            className={cn(
              "flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors",
              onlyFavs ? "border-amber-400 bg-amber-400/15 text-amber-600 dark:text-amber-300" : "text-muted-foreground hover:bg-muted",
            )}
          >
            <StarIcon className={cn("size-3.5", onlyFavs && "fill-amber-400 text-amber-400")} />
            Favorites
          </button>
          {allTags.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tag === t}
              onClick={() => setTag(tag === t ? null : t)}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                tag === t ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="text-muted-foreground rounded-2xl border border-dashed px-4 py-8 text-center text-sm">
          No recipes match{filtering ? " those filters" : ""}.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {shown.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              canManage={canManage}
              onOpen={() => onOpen(recipe)}
              onEdit={() => onEdit(recipe)}
              onAddToGroceries={() => onAddToGroceries(recipe)}
              onToggleFavorite={() => onToggleFavorite(recipe)}
              aggregating={aggregating}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function RecipeCard({
  recipe,
  canManage,
  onOpen,
  onEdit,
  onAddToGroceries,
  onToggleFavorite,
  aggregating,
}: {
  recipe: RecipeOut
  canManage: boolean
  onOpen: () => void
  onEdit: () => void
  onAddToGroceries: () => void
  onToggleFavorite: () => void
  aggregating: boolean
}) {
  const total = (recipe.prep_minutes ?? 0) + (recipe.cook_minutes ?? 0)
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`View ${recipe.name}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        // Only the card itself — let the nested buttons handle their own keys.
        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault()
          onOpen()
        }
      }}
      className="bg-card ring-foreground/5 hover:ring-primary/30 focus-visible:ring-ring flex cursor-pointer flex-col gap-2 rounded-2xl p-3 shadow-sm ring-1 transition-shadow outline-none hover:shadow-md focus-visible:ring-2"
    >
      <div className="flex items-start gap-2">
        {recipe.image_url && (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary external recipe URL; next/image would need per-host config
          <img src={recipe.image_url} alt="" className="size-12 shrink-0 rounded-xl object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate leading-tight font-semibold">{recipe.name}</p>
          <p className="text-muted-foreground text-xs">
            {recipe.ingredients.length} ingredient{recipe.ingredients.length === 1 ? "" : "s"}
            {recipe.servings ? ` · serves ${recipe.servings}` : ""}
            {total > 0 ? ` · ${total} min` : ""}
          </p>
        </div>
        {canManage && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={recipe.is_favorite ? `Unfavorite ${recipe.name}` : `Favorite ${recipe.name}`}
              aria-pressed={recipe.is_favorite}
              onClick={(e) => {
                e.stopPropagation()
                onToggleFavorite()
              }}
              className="shrink-0"
            >
              <StarIcon className={cn(recipe.is_favorite ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Edit ${recipe.name}`}
              onClick={(e) => {
                e.stopPropagation()
                onEdit()
              }}
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              <PencilIcon />
            </Button>
          </>
        )}
        {!canManage && recipe.is_favorite && (
          <StarIcon className="size-4 shrink-0 fill-amber-400 text-amber-400" aria-label="Favorite" />
        )}
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
        {recipe.rating && <RecipeStars value={recipe.rating} size="size-3.5" />}
        <span>{usageLabel(recipe)}</span>
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
