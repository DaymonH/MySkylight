"use client"

import { useState } from "react"
import { toast } from "sonner"

import { useCreateMeal } from "@/hooks/use-meals"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { MealSlot, RecipeOut } from "@/lib/types/meal"

const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
}

/** Assign a meal to a given date + slot — either a saved recipe or free text. */
export function AddMealDialog({
  open,
  onClose,
  familyId,
  date,
  slot,
  recipes,
  dateLabel,
}: {
  open: boolean
  onClose: () => void
  familyId: string
  date: string | null
  slot: MealSlot | null
  recipes: RecipeOut[]
  dateLabel: string
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a meal</DialogTitle>
          <DialogDescription>
            {slot ? SLOT_LABELS[slot] : ""} · {dateLabel}
          </DialogDescription>
        </DialogHeader>
        {open && date && slot && (
          // Mounted only while open so its state resets each time the dialog opens.
          <AddMealForm
            key={`${date}|${slot}`}
            familyId={familyId}
            date={date}
            slot={slot}
            recipes={recipes}
            onDone={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function AddMealForm({
  familyId,
  date,
  slot,
  recipes,
  onDone,
}: {
  familyId: string
  date: string
  slot: MealSlot
  recipes: RecipeOut[]
  onDone: () => void
}) {
  const createMeal = useCreateMeal(familyId)
  const [mode, setMode] = useState<"recipe" | "text">(recipes.length > 0 ? "recipe" : "text")
  const [recipeId, setRecipeId] = useState("")
  const [title, setTitle] = useState("")

  function handleAdd() {
    if (mode === "recipe" && !recipeId) {
      toast.error("Pick a recipe.")
      return
    }
    if (mode === "text" && !title.trim()) {
      toast.error("Enter a meal name.")
      return
    }
    const data =
      mode === "recipe"
        ? { date, slot, recipe_id: recipeId }
        : { date, slot, title: title.trim() }
    createMeal.mutate(data, {
      onSuccess: () => onDone(),
      onError: () => toast.error("Couldn't add the meal. Please try again."),
    })
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        <ToggleGroup
          type="single"
          variant="outline"
          value={mode}
          onValueChange={(v) => v && setMode(v as "recipe" | "text")}
          className="justify-start"
        >
          <ToggleGroupItem value="recipe" disabled={recipes.length === 0}>
            From recipe
          </ToggleGroupItem>
          <ToggleGroupItem value="text">Free text</ToggleGroupItem>
        </ToggleGroup>

        {mode === "recipe" ? (
          <div className="space-y-1.5">
            <Label>Recipe</Label>
            <Select value={recipeId} onValueChange={setRecipeId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a recipe…" />
              </SelectTrigger>
              <SelectContent>
                {recipes.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="meal-title">Meal</Label>
            <Input
              id="meal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Leftovers, Takeout"
              maxLength={200}
              autoFocus
            />
          </div>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="button" onClick={handleAdd} disabled={createMeal.isPending}>
          Add meal
        </Button>
      </DialogFooter>
    </>
  )
}
