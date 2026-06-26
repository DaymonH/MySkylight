"use client"

import { Fragment, useEffect } from "react"
import { useFieldArray, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { GripVerticalIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import type { RecipeCreatePayload, RecipeOut } from "@/lib/types/meal"

// Numeric fields are kept as strings in the form (empty number inputs otherwise
// surface as NaN); they're parsed to number | null on submit.
const schema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().optional(),
  instructions: z.string().optional(),
  image_url: z.string().max(1000).optional(),
  source_url: z.string().max(1000).optional(),
  servings: z.string().optional(),
  prep_minutes: z.string().optional(),
  cook_minutes: z.string().optional(),
  tags: z.string().optional(),
  ingredients: z.array(
    z.object({
      name: z.string().max(200).optional(),
      quantity: z.string().optional(),
      unit: z.string().max(50).optional(),
      section: z.string().max(100).optional(),
    }),
  ),
})
export type RecipeFormValues = z.infer<typeof schema>

const BLANK: RecipeFormValues = {
  name: "",
  description: "",
  instructions: "",
  image_url: "",
  source_url: "",
  servings: "",
  prep_minutes: "",
  cook_minutes: "",
  tags: "",
  ingredients: [{ name: "", quantity: "", unit: "", section: "" }],
}

function toNumberOrNull(s?: string): number | null {
  const t = s?.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Map the form to the API payload, dropping blank ingredient rows. */
export function toRecipePayload(v: RecipeFormValues): RecipeCreatePayload {
  return {
    name: v.name.trim(),
    description: v.description?.trim() || null,
    instructions: v.instructions?.trim() || null,
    image_url: v.image_url?.trim() || null,
    source_url: v.source_url?.trim() || null,
    servings: toNumberOrNull(v.servings),
    prep_minutes: toNumberOrNull(v.prep_minutes),
    cook_minutes: toNumberOrNull(v.cook_minutes),
    tags: (v.tags ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    ingredients: v.ingredients
      .filter((i) => i.name?.trim())
      .map((i, idx) => ({
        name: i.name!.trim(),
        quantity: toNumberOrNull(i.quantity),
        unit: i.unit?.trim() || null,
        section: i.section?.trim() || null,
        sort_order: idx,
      })),
  }
}

interface RecipeSheetProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: RecipeFormValues) => void
  onDelete?: () => void
  isPending: boolean
  isDeleting?: boolean
  editing?: RecipeOut
  /** Seed the form for a NEW recipe (create mode) — used by Magic Import review. */
  prefill?: RecipeFormValues
}

export function RecipeSheet({
  open,
  onClose,
  onSubmit,
  onDelete,
  isPending,
  isDeleting,
  editing,
  prefill,
}: RecipeSheetProps) {
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<RecipeFormValues>({ resolver: zodResolver(schema), defaultValues: BLANK })

  const { fields, append, remove } = useFieldArray({ control, name: "ingredients" })

  // Live ingredient values drive the grouped section subheadings as the user types.
  const watchedIngredients = useWatch({ control, name: "ingredients" })
  const sectionAt = (i: number) => (watchedIngredients?.[i]?.section ?? "").trim()

  useEffect(() => {
    if (!open) return
    reset(
      editing
        ? {
            name: editing.name,
            description: editing.description ?? "",
            instructions: editing.instructions ?? "",
            image_url: editing.image_url ?? "",
            source_url: editing.source_url ?? "",
            servings: editing.servings != null ? String(editing.servings) : "",
            prep_minutes: editing.prep_minutes != null ? String(editing.prep_minutes) : "",
            cook_minutes: editing.cook_minutes != null ? String(editing.cook_minutes) : "",
            tags: editing.tags.join(", "),
            ingredients: editing.ingredients.length
              ? editing.ingredients.map((i) => ({
                  name: i.name,
                  quantity: i.quantity != null ? String(i.quantity) : "",
                  unit: i.unit ?? "",
                  section: i.section ?? "",
                }))
              : [{ name: "", quantity: "", unit: "", section: "" }],
          }
        : (prefill ?? BLANK),
    )
  }, [open, editing, prefill]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b">
          <SheetTitle className="text-lg">{editing ? "Edit recipe" : "New recipe"}</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
          <div className="thin-scrollbar flex-1 space-y-5 overflow-y-auto p-6">
            <div className="space-y-1.5">
              <Label htmlFor="recipe-name">Name</Label>
              <Input id="recipe-name" {...register("name")} placeholder="e.g. Veggie chili" />
              {errors.name && <p className="text-destructive text-xs">{errors.name.message}</p>}
            </div>

            <div className="flex gap-3">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="recipe-servings">Servings</Label>
                <Input
                  id="recipe-servings"
                  type="number"
                  min={0}
                  {...register("servings")}
                  placeholder="4"
                />
              </div>
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="recipe-prep">Prep (min)</Label>
                <Input
                  id="recipe-prep"
                  type="number"
                  min={0}
                  {...register("prep_minutes")}
                  placeholder="15"
                />
              </div>
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="recipe-cook">Cook (min)</Label>
                <Input
                  id="recipe-cook"
                  type="number"
                  min={0}
                  {...register("cook_minutes")}
                  placeholder="30"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="recipe-tags">Tags</Label>
              <Input id="recipe-tags" {...register("tags")} placeholder="vegetarian, quick" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="recipe-image">Image URL</Label>
              <Input id="recipe-image" {...register("image_url")} placeholder="https://…" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="recipe-source">Source URL</Label>
              <Input
                id="recipe-source"
                {...register("source_url")}
                placeholder="https://… (where this recipe came from)"
              />
            </div>

            {/* Ingredients */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Ingredients</Label>
                <span className="text-muted-foreground text-xs">qty · unit · name · section</span>
              </div>
              <div className="flex flex-col gap-2">
                {fields.map((field, idx) => {
                  const section = sectionAt(idx)
                  const showHeader =
                    section.length > 0 && section !== (idx > 0 ? sectionAt(idx - 1) : "")
                  return (
                    <Fragment key={field.id}>
                      {showHeader && (
                        <p className="text-muted-foreground mt-1 px-1 text-xs font-semibold tracking-wide uppercase">
                          {section}
                        </p>
                      )}
                      <div className="flex items-center gap-2">
                        <GripVerticalIcon className="text-muted-foreground/40 size-4 shrink-0" />
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          className="w-14 px-2"
                          placeholder="2"
                          aria-label="Quantity"
                          {...register(`ingredients.${idx}.quantity`)}
                        />
                        <Input
                          className="w-16 px-2"
                          placeholder="cups"
                          aria-label="Unit"
                          {...register(`ingredients.${idx}.unit`)}
                        />
                        <Input
                          className="flex-1"
                          placeholder="Flour"
                          aria-label="Ingredient name"
                          {...register(`ingredients.${idx}.name`)}
                        />
                        <Input
                          className="w-24 px-2"
                          placeholder="Section"
                          aria-label="Ingredient section"
                          {...register(`ingredients.${idx}.section`)}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Remove ingredient"
                          onClick={() => remove(idx)}
                          className="text-muted-foreground hover:text-destructive shrink-0"
                        >
                          <XIcon />
                        </Button>
                      </div>
                    </Fragment>
                  )
                })}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  append({
                    name: "",
                    quantity: "",
                    unit: "",
                    // Carry the last row's section so adding within a group keeps it grouped.
                    section: fields.length ? sectionAt(fields.length - 1) : "",
                  })
                }
              >
                <PlusIcon /> Add ingredient
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="recipe-desc">Description</Label>
              <Textarea id="recipe-desc" {...register("description")} placeholder="A short note" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="recipe-steps">Instructions</Label>
              <Textarea
                id="recipe-steps"
                {...register("instructions")}
                placeholder="Steps to make it"
                className="min-h-28"
              />
            </div>
          </div>

          <SheetFooter className="flex-row items-center gap-2 border-t">
            {onDelete && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="destructive" size="icon" aria-label="Delete recipe">
                    <Trash2Icon />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this recipe?</AlertDialogTitle>
                    <AlertDialogDescription>
                      It will be removed from the library and from any meals that reference it.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={onDelete} disabled={isDeleting}>
                      {isDeleting ? "Deleting…" : "Delete"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={isPending}>
              {isPending ? "Saving…" : editing ? "Save changes" : "Create recipe"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
