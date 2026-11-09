export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack"

export const MEAL_SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"]

// ── Recipes ─────────────────────────────────────────────────────────────────

export interface RecipeIngredient {
  id: string
  name: string
  quantity: number | null
  unit: string | null
  section: string | null
  sort_order: number
}

export interface RecipeIngredientInput {
  name: string
  quantity?: number | null
  unit?: string | null
  section?: string | null
  sort_order?: number
}

export interface RecipeBrief {
  id: string
  name: string
  image_url: string | null
}

export interface RecipeOut {
  id: string
  family_id: string
  name: string
  description: string | null
  instructions: string | null
  image_url: string | null
  servings: number | null
  prep_minutes: number | null
  cook_minutes: number | null
  source_url: string | null
  tags: string[]
  is_favorite: boolean
  rating: number | null
  // Derived from past meal plans (up to today).
  last_made: string | null
  times_made: number
  ingredients: RecipeIngredient[]
  created_at: string
  updated_at: string
}

export interface RecipeCreatePayload {
  name: string
  description?: string | null
  instructions?: string | null
  image_url?: string | null
  servings?: number | null
  prep_minutes?: number | null
  cook_minutes?: number | null
  source_url?: string | null
  tags?: string[]
  ingredients?: RecipeIngredientInput[]
}

export type RecipeUpdatePayload = Partial<RecipeCreatePayload> & {
  is_favorite?: boolean
  rating?: number | null // null clears the rating
}

// ── Meal plans ──────────────────────────────────────────────────────────────

export type MealKind = "meal" | "leftovers" | "eating_out"

export interface MealPlanOut {
  id: string
  family_id: string
  date: string // ISO date (YYYY-MM-DD)
  slot: MealSlot
  recipe_id: string | null
  title: string | null
  display_title: string
  kind: MealKind
  servings: number | null
  recipe: RecipeBrief | null
  calendar_event_id: string | null
  created_at: string
  updated_at: string
}

export interface MealPlanCreatePayload {
  date: string
  slot: MealSlot
  recipe_id?: string | null
  title?: string | null
  kind?: MealKind
  servings?: number | null
}

export type MealPlanUpdatePayload = Partial<MealPlanCreatePayload>

export interface MealCopyPayload {
  from_date: string
  to_date: string
  days?: number
}

export interface MealAutofillPayload {
  from_date: string
  to_date: string
  slots?: MealSlot[]
}

// ── Grocery aggregation (F28) ─────────────────────────────────────────────────

export interface AggregatedLine {
  name: string
  quantity: number | null
  unit: string | null
  from_recipes: string[]
}

export interface GroceryAggregatePayload {
  recipe_ids?: string[]
  // Cook-for-N override per recipe id (scales that recipe's quantities).
  recipe_servings?: Record<string, number>
  from_date?: string
  to_date?: string
}

export interface GroceryBuildItem {
  text: string
  quantity?: string | null
  category?: string | null
}

export interface GroceryBuildPayload {
  list_id?: string
  list_name?: string
  items: GroceryBuildItem[]
}
