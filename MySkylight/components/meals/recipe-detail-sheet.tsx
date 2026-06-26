"use client"

import { Fragment } from "react"
import { ExternalLinkIcon, PencilIcon, ShoppingCartIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { RecipeOut } from "@/lib/types/meal"

// A one-line summary shown under the title — also satisfies the sheet's aria-description.
function metaSummary(r: RecipeOut): string {
  const parts: string[] = []
  if (r.servings) parts.push(`Serves ${r.servings}`)
  const total = (r.prep_minutes ?? 0) + (r.cook_minutes ?? 0)
  if (total > 0) parts.push(`${total} min total`)
  if (parts.length === 0) {
    const n = r.ingredients.length
    parts.push(`${n} ingredient${n === 1 ? "" : "s"}`)
  }
  return parts.join(" · ")
}

/**
 * Read-only view of a saved recipe — opened by tapping a recipe card. Shows the full
 * ingredients (grouped by section) and instructions without the edit form. Owner/adult get
 * "Edit" and "Add to groceries" actions in the footer; everyone else just reads.
 */
export function RecipeDetailSheet({
  open,
  onClose,
  recipe,
  canManage,
  onEdit,
  onAddToGroceries,
  aggregating,
}: {
  open: boolean
  onClose: () => void
  recipe: RecipeOut | null
  canManage: boolean
  onEdit: () => void
  onAddToGroceries: () => void
  aggregating: boolean
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-lg">
        {recipe && (
          <>
            <SheetHeader className="border-b pr-14">
              <SheetTitle className="text-lg">{recipe.name}</SheetTitle>
              <SheetDescription>{metaSummary(recipe)}</SheetDescription>
            </SheetHeader>

            <div className="thin-scrollbar flex-1 space-y-5 overflow-y-auto p-6">
              {recipe.image_url && (
                // eslint-disable-next-line @next/next/no-img-element -- arbitrary external recipe URL; next/image would need per-host config
                <img
                  src={recipe.image_url}
                  alt={recipe.name}
                  className="max-h-56 w-full rounded-2xl object-cover"
                />
              )}

              {recipe.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {recipe.tags.map((t) => (
                    <Badge key={t} variant="secondary">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}

              {recipe.description && (
                <p className="break-words whitespace-pre-line text-muted-foreground">
                  {recipe.description}
                </p>
              )}

              <section className="space-y-2">
                <h3 className="font-heading font-semibold">Ingredients</h3>
                {recipe.ingredients.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No ingredients listed.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {recipe.ingredients.map((ing, idx) => {
                      const section = (ing.section ?? "").trim()
                      const prev =
                        idx > 0
                          ? (recipe.ingredients[idx - 1].section ?? "").trim()
                          : ""
                      const showHeader = section.length > 0 && section !== prev
                      const measure = [
                        ing.quantity != null ? String(ing.quantity) : "",
                        ing.unit ?? "",
                      ]
                        .filter(Boolean)
                        .join(" ")
                      return (
                        <Fragment key={ing.id}>
                          {showHeader && (
                            <li className="mt-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                              {section}
                            </li>
                          )}
                          <li className="flex gap-2">
                            {measure && (
                              <span className="w-20 shrink-0 text-muted-foreground tabular-nums">
                                {measure}
                              </span>
                            )}
                            <span className="break-words">{ing.name}</span>
                          </li>
                        </Fragment>
                      )
                    })}
                  </ul>
                )}
              </section>

              {recipe.instructions && (
                <section className="space-y-2">
                  <h3 className="font-heading font-semibold">Instructions</h3>
                  <p className="break-words whitespace-pre-line">
                    {recipe.instructions}
                  </p>
                </section>
              )}

              {recipe.source_url && (
                <a
                  href={recipe.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  <ExternalLinkIcon className="size-3.5" /> View original recipe
                </a>
              )}
            </div>

            {canManage && (
              <SheetFooter className="flex-row items-center gap-2 border-t">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={onAddToGroceries}
                  disabled={aggregating || recipe.ingredients.length === 0}
                >
                  <ShoppingCartIcon /> Add to groceries
                </Button>
                <Button type="button" className="flex-1" onClick={onEdit}>
                  <PencilIcon /> Edit
                </Button>
              </SheetFooter>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
