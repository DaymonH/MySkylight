// Magic Import (F17) — shapes returned by the AI extraction endpoints. Drafts mirror the
// event/recipe create payloads (plus review-only metadata) so they save through the existing
// create endpoints after the user reviews them.

export interface EventDraft {
  title: string
  description: string | null
  location: string | null
  start_dt: string // ISO datetime (tz-aware)
  end_dt: string
  all_day: boolean
  is_countdown: boolean
  // Review-only: the model/back end was unsure about these; the UI badges them.
  year_inferred: boolean
  time_inferred: boolean
}

export interface EventExtractionResult {
  events: EventDraft[]
  confidence: number
  notes: string | null
}

export interface IngredientDraft {
  name: string
  quantity: number | null
  unit: string | null
  section: string | null
  sort_order: number
}

export interface RecipeDraft {
  name: string
  description: string | null
  instructions: string | null
  image_url: string | null
  servings: number | null
  prep_minutes: number | null
  cook_minutes: number | null
  tags: string[]
  ingredients: IngredientDraft[]
  confidence: number
  source_url: string | null
}

export interface ImageCandidate {
  url: string
  alt: string | null
}

export interface RecipeExtractionResult {
  recipe: RecipeDraft | null
  // Likeliest main photos found on the page, best first (link import only).
  image_candidates?: ImageCandidate[]
  confidence: number
  notes: string | null
}

export interface FileExtractPayload {
  file_base64: string
  mime_type: string
}

export interface RecipeLinkPayload {
  url: string
}
