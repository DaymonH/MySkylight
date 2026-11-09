"use client"

import { use, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { BookOpenIcon, PlusIcon, SparklesIcon, UtensilsCrossedIcon } from "lucide-react"

import { useApi } from "@/hooks/use-api"
import { useRealtime } from "@/hooks/use-realtime"
import {
  useAggregateGrocery,
  useCreateRecipe,
  useDeleteRecipe,
  useRecipes,
  useSetRecipeImage,
  useUpdateRecipe,
} from "@/hooks/use-meals"
import { GroceryBuildDialog } from "@/components/meals/grocery-build-dialog"
import { RecipeImportDialog } from "@/components/meals/recipe-import-dialog"
import { RecipeDetailSheet } from "@/components/meals/recipe-detail-sheet"
import { RecipeLibrary } from "@/components/meals/recipe-library"
import { WeekPlanner } from "@/components/meals/week-planner"
import {
  RecipeSheet,
  type RecipeFormValues,
  toRecipePayload,
} from "@/components/meals/recipe-sheet"
import { splitRemotePhoto } from "@/lib/recipe-photo"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { AggregatedLine, RecipeOut } from "@/lib/types/meal"

interface MembershipResponse {
  id: string
  family_id: string
  role: "owner" | "adult" | "child" | "viewer"
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

  const { data: recipes = [], isLoading: recipesLoading } = useRecipes(familyId)
  const updateRecipe = useUpdateRecipe(familyId)
  const aggregate = useAggregateGrocery(familyId)

  const [recipeSheet, setRecipeSheet] = useState<{
    open: boolean
    editing?: RecipeOut
  }>({ open: false })
  const [detailId, setDetailId] = useState<string | null>(null)
  // Always read the live recipe so favorite / rating changes show straight away.
  const detailRecipe = recipes.find((r) => r.id === detailId) ?? null
  const [importOpen, setImportOpen] = useState(false)
  const [build, setBuild] = useState<{
    open: boolean
    lines: AggregatedLine[]
    name: string
  }>({ open: false, lines: [], name: "" })

  function openBuild(lines: AggregatedLine[], name: string) {
    if (lines.length === 0) {
      toast.info("No recipe ingredients to add — plan some recipes first.")
      return
    }
    setBuild({ open: true, lines, name })
  }

  function buildWeekGroceries(from: string, to: string, label: string) {
    aggregate.mutate(
      { from_date: from, to_date: to },
      {
        onSuccess: (lines) => openBuild(lines, label),
        onError: () => toast.error("Couldn't aggregate this week's ingredients."),
      }
    )
  }

  function buildRecipeGroceries(recipe: RecipeOut, servings: number | null = null) {
    aggregate.mutate(
      {
        recipe_ids: [recipe.id],
        ...(servings ? { recipe_servings: { [recipe.id]: servings } } : {}),
      },
      {
        onSuccess: (lines) => openBuild(lines, `${recipe.name} groceries`),
        onError: () => toast.error("Couldn't aggregate this recipe."),
      }
    )
  }

  function toggleFavorite(recipe: RecipeOut) {
    updateRecipe.mutate(
      { recipeId: recipe.id, data: { is_favorite: !recipe.is_favorite } },
      { onError: () => toast.error("Couldn't update the favorite.") }
    )
  }

  function rate(recipe: RecipeOut, rating: number | null) {
    updateRecipe.mutate(
      { recipeId: recipe.id, data: { rating } },
      { onError: () => toast.error("Couldn't save the rating.") }
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

      <Tabs defaultValue="week" className="gap-4">
        <TabsList>
          <TabsTrigger value="week" className="gap-1.5">
            <UtensilsCrossedIcon className="size-4" /> This week
          </TabsTrigger>
          <TabsTrigger value="recipes" className="gap-1.5">
            <BookOpenIcon className="size-4" /> Recipes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="week">
          <WeekPlanner
            familyId={familyId}
            canManage={canManage}
            recipes={recipes}
            onBuildGroceries={buildWeekGroceries}
            building={aggregate.isPending}
          />
        </TabsContent>

        <TabsContent value="recipes" className="flex flex-col gap-4">
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setRecipeSheet({ open: true })}>
                <PlusIcon /> New recipe
              </Button>
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                <SparklesIcon /> Add with AI
              </Button>
            </div>
          )}
          <RecipeLibrary
            recipes={recipes}
            loading={recipesLoading}
            canManage={canManage}
            onOpen={(r) => setDetailId(r.id)}
            onEdit={(r) => setRecipeSheet({ open: true, editing: r })}
            onAddToGroceries={(r) => buildRecipeGroceries(r)}
            onToggleFavorite={toggleFavorite}
            aggregating={aggregate.isPending}
          />
        </TabsContent>
      </Tabs>

      <RecipeSheetContainer
        familyId={familyId}
        state={recipeSheet}
        onClose={() => setRecipeSheet({ open: false })}
      />

      <RecipeDetailSheet
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        recipe={detailRecipe}
        canManage={canManage}
        onEdit={() => {
          const recipe = detailRecipe
          setDetailId(null)
          if (recipe) setRecipeSheet({ open: true, editing: recipe })
        }}
        onAddToGroceries={(servings) => {
          if (detailRecipe) buildRecipeGroceries(detailRecipe, servings)
        }}
        onToggleFavorite={() => detailRecipe && toggleFavorite(detailRecipe)}
        onRate={(rating) => detailRecipe && rate(detailRecipe, rating)}
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
  const setPhoto = useSetRecipeImage(familyId)
  const editing = state.editing

  async function handleSubmit(values: RecipeFormValues) {
    // A photo URL from another site is copied to our server once the recipe is saved.
    const { payload, remote } = splitRemotePhoto(toRecipePayload(values))
    try {
      const saved = editing
        ? await updateRecipe.mutateAsync({ recipeId: editing.id, data: payload })
        : await createRecipe.mutateAsync(payload)
      if (remote) {
        try {
          await setPhoto.mutateAsync({ recipeId: saved.id, url: remote, referer: payload.source_url })
        } catch {
          toast.warning("Recipe saved, but its photo couldn't be saved. Check the link and try again.")
          onClose()
          return
        }
      }
      onClose()
      toast.success(editing ? "Recipe saved" : "Recipe created")
    } catch {
      toast.error(
        editing ? "Couldn't save the recipe. Please try again." : "Couldn't create the recipe. Please try again."
      )
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
      isPending={createRecipe.isPending || updateRecipe.isPending || setPhoto.isPending}
      isDeleting={deleteRecipe.isPending}
      editing={editing}
    />
  )
}
