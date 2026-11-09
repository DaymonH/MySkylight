import type { RecipeOut } from "@/lib/types/meal"

/** Multiplier for cooking `servings` people from a recipe written for `recipe.servings`. */
export function scaleFactor(recipe: Pick<RecipeOut, "servings">, servings: number | null): number {
  return servings && recipe.servings && recipe.servings > 0 ? servings / recipe.servings : 1
}

/** A friendly quantity: 2, 1.5, 0.33 → "2", "1.5", "0.33" (never "1.5000001"). */
export function fmtQty(q: number): string {
  const r = Math.round(q * 100) / 100
  return Number.isInteger(r) ? String(r) : String(r)
}

/** Lowercased name with a trailing plural "s" dropped, so "Eggs" and "egg" match. */
export function canonName(name: string): string {
  const n = name.trim().toLowerCase()
  return n.length > 3 && n.endsWith("s") && !n.endsWith("ss") ? n.slice(0, -1) : n
}
