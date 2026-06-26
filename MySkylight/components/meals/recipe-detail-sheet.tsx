"use client"

import { PencilIcon, ShoppingCartIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { RecipeContent, metaSummary } from "@/components/meals/recipe-content"
import type { RecipeOut } from "@/lib/types/meal"

/**
 * Read-only view of a saved recipe — opened by tapping a recipe card. Shows the full
 * ingredients (grouped by section) and numbered instruction steps without the edit form.
 * Owner/adult get "Edit" and "Add to groceries" actions in the footer; everyone else just reads.
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

            <div className="thin-scrollbar flex-1 overflow-y-auto p-6">
              <RecipeContent recipe={recipe} />
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
