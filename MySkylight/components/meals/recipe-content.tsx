import { Fragment } from "react"
import { ExternalLinkIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { parseSteps } from "@/lib/recipe-steps"
import { cn } from "@/lib/utils"
import type { RecipeOut } from "@/lib/types/meal"

/** A one-line summary (serves / time) — handy for sheet/page headers and aria descriptions. */
export function metaSummary(r: RecipeOut): string {
  const parts: string[] = []
  if (r.servings) parts.push(`Serves ${r.servings}`)
  const total = (r.prep_minutes ?? 0) + (r.cook_minutes ?? 0)
  if (total > 0) parts.push(`${total} min total`)
  if (parts.length === 0) {
    const n = r.ingredients.length
    parts.push(`${n} ingredient${n === 1 ? "" : "s"}`)
  }
  return parts.join(" · ")
}

/**
 * Read-only body of a recipe: image, tags, description, grouped ingredients, and numbered
 * instruction steps. Shared by the companion-app detail sheet and the kiosk recipe reader so
 * both render recipes identically. No header/footer — the caller supplies those.
 */
export function RecipeContent({
  recipe,
  className,
}: {
  recipe: RecipeOut
  className?: string
}) {
  const steps = parseSteps(recipe.instructions)

  return (
    <div className={cn("space-y-5", className)}>
      {recipe.image_url && (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary external recipe URL; next/image would need per-host config
        <img
          src={recipe.image_url}
          alt={recipe.name}
          className="max-h-56 w-full rounded-2xl object-cover"
        />
      )}

      {recipe.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {recipe.tags.map((t) => (
            <Badge key={t} variant="secondary">
              {t}
            </Badge>
          ))}
        </div>
      )}

      {recipe.description && (
        <p className="text-muted-foreground break-words whitespace-pre-line">
          {recipe.description}
        </p>
      )}

      <section className="space-y-2">
        <h3 className="font-heading font-semibold">Ingredients</h3>
        {recipe.ingredients.length === 0 ? (
          <p className="text-muted-foreground text-sm">No ingredients listed.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {recipe.ingredients.map((ing, idx) => {
              const section = (ing.section ?? "").trim()
              const prev = idx > 0 ? (recipe.ingredients[idx - 1].section ?? "").trim() : ""
              const showHeader = section.length > 0 && section !== prev
              const measure = [ing.quantity != null ? String(ing.quantity) : "", ing.unit ?? ""]
                .filter(Boolean)
                .join(" ")
              return (
                <Fragment key={ing.id}>
                  {showHeader && (
                    <li className="text-muted-foreground mt-2 text-xs font-semibold tracking-wide uppercase">
                      {section}
                    </li>
                  )}
                  <li className="flex gap-2">
                    {measure && (
                      <span className="text-muted-foreground w-20 shrink-0 tabular-nums">
                        {measure}
                      </span>
                    )}
                    <span className="break-words">{ing.name}</span>
                  </li>
                </Fragment>
              )
            })}
          </ul>
        )}
      </section>

      {steps.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-heading font-semibold">Instructions</h3>
          <ol className="flex flex-col gap-3">
            {steps.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums">
                  {i + 1}
                </span>
                <span className="leading-relaxed break-words">{step}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {recipe.source_url && (
        <a
          href={recipe.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
        >
          <ExternalLinkIcon className="size-3.5" /> View original recipe
        </a>
      )}
    </div>
  )
}
