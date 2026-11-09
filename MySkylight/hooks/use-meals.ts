"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useApi } from "@/hooks/use-api"
import type { ListOut } from "@/lib/types/list"
import type {
  AggregatedLine,
  GroceryAggregatePayload,
  GroceryBuildPayload,
  MealAutofillPayload,
  MealCopyPayload,
  MealPlanCreatePayload,
  MealPlanOut,
  MealPlanUpdatePayload,
  RecipeCreatePayload,
  RecipeOut,
  RecipeUpdatePayload,
} from "@/lib/types/meal"

// ── Recipes ─────────────────────────────────────────────────────────────────

export function useRecipes(familyId: string) {
  const api = useApi()
  return useQuery({
    queryKey: ["recipes", familyId],
    queryFn: () => api.get<RecipeOut[]>(`/families/${familyId}/recipes`),
    enabled: !!familyId,
  })
}

export function useCreateRecipe(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: RecipeCreatePayload) =>
      api.post<RecipeOut>(`/families/${familyId}/recipes`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recipes", familyId] }),
  })
}

export function useUpdateRecipe(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ recipeId, data }: { recipeId: string; data: RecipeUpdatePayload }) =>
      api.patch<RecipeOut>(`/families/${familyId}/recipes/${recipeId}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recipes", familyId] }),
  })
}

export function useDeleteRecipe(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (recipeId: string) => api.delete(`/families/${familyId}/recipes/${recipeId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recipes", familyId] }),
  })
}

// ── Meal plans ──────────────────────────────────────────────────────────────

export function useMealPlans(familyId: string, from: string, to: string) {
  const api = useApi()
  return useQuery({
    queryKey: ["mealplans", familyId, from, to],
    queryFn: () =>
      api.get<MealPlanOut[]>(`/families/${familyId}/mealplans?from=${from}&to=${to}`),
    enabled: !!familyId && !!from && !!to,
  })
}

export function useCreateMeal(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: MealPlanCreatePayload) =>
      api.post<MealPlanOut>(`/families/${familyId}/mealplans`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mealplans", familyId] })
      qc.invalidateQueries({ queryKey: ["recipes", familyId] }) // "last made"
    },
  })
}

export function useUpdateMeal(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ mealId, data }: { mealId: string; data: MealPlanUpdatePayload }) =>
      api.patch<MealPlanOut>(`/families/${familyId}/mealplans/${mealId}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mealplans", familyId] }),
  })
}

export function useDeleteMeal(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (mealId: string) => api.delete(`/families/${familyId}/mealplans/${mealId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mealplans", familyId] }),
  })
}

/** Copy one week's meals onto another; slots already planned there are left alone. */
export function useCopyMeals(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: MealCopyPayload) =>
      api.post<MealPlanOut[]>(`/families/${familyId}/mealplans/copy`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mealplans", familyId] })
      qc.invalidateQueries({ queryKey: ["recipes", familyId] })
    },
  })
}

/** Fill empty slots with recipes that haven't been cooked lately. */
export function useAutofillMeals(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: MealAutofillPayload) =>
      api.post<MealPlanOut[]>(`/families/${familyId}/mealplans/autofill`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mealplans", familyId] })
      qc.invalidateQueries({ queryKey: ["recipes", familyId] })
    },
  })
}

export function useMealToCalendar(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (mealId: string) =>
      api.post<MealPlanOut>(`/families/${familyId}/mealplans/${mealId}/to-calendar`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mealplans", familyId] })
      qc.invalidateQueries({ queryKey: ["occurrences", familyId] })
    },
  })
}

// ── Grocery aggregation (F28) ─────────────────────────────────────────────────

/** Preview-only: aggregate ingredients from recipes/a meal-plan range. No write. */
export function useAggregateGrocery(familyId: string) {
  const api = useApi()
  return useMutation({
    mutationFn: (data: GroceryAggregatePayload) =>
      api.post<AggregatedLine[]>(`/families/${familyId}/grocery/aggregate`, data),
  })
}

/** Commit the reviewed lines into a new or existing grocery list. */
export function useBuildGrocery(familyId: string) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: GroceryBuildPayload) =>
      api.post<ListOut>(`/families/${familyId}/grocery/build`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lists", familyId] }),
  })
}
