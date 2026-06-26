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

export type RecipeUpdatePayload = Partial<RecipeCreatePayload>

// ── Meal plans ──────────────────────────────────────────────────────────────

export interface MealPlanOut {
  id: string
  family_id: string
  date: string // ISO date (YYYY-MM-DD)
  slot: MealSlot
  recipe_id: string | null
  title: string | null
  display_title: string
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
}

export type MealPlanUpdatePayload = Partial<MealPlanCreatePayload>

// ── Grocery aggregation (F28) ─────────────────────────────────────────────────

export interface AggregatedLine {
  name: string
  quantity: number | null
  unit: string | null
  from_recipes: string[]
}

export interface GroceryAggregatePayload {
  recipe_ids?: string[]
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
