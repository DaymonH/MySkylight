"use client"

import { useMutation } from "@tanstack/react-query"
import { useApi } from "@/hooks/use-api"
import type {
  EventExtractionResult,
  FileExtractPayload,
  RecipeExtractionResult,
  RecipeLinkPayload,
} from "@/lib/types/magic-import"

// Extraction is read-only — these mutations create no rows and invalidate no cache. The
// returned drafts are reviewed/edited in a sheet, then saved via useCreateEvent/useCreateRecipe.

export function useExtractEventsFromFlyer(familyId: string) {
  const api = useApi()
  return useMutation({
    mutationFn: (data: FileExtractPayload) =>
      api.post<EventExtractionResult>(`/families/${familyId}/magic-import/events`, data),
  })
}

export function useExtractRecipeFromImage(familyId: string) {
  const api = useApi()
  return useMutation({
    mutationFn: (data: FileExtractPayload) =>
      api.post<RecipeExtractionResult>(`/families/${familyId}/magic-import/recipes/image`, data),
  })
}

export function useExtractRecipeFromLink(familyId: string) {
  const api = useApi()
  return useMutation({
    mutationFn: (data: RecipeLinkPayload) =>
      api.post<RecipeExtractionResult>(`/families/${familyId}/magic-import/recipes/link`, data),
  })
}
