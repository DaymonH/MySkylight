// Recipe instructions are stored as free text. The backend now normalizes AI imports to one step
// per line, but older recipes (and hand-typed ones) can be a single run-on paragraph. parseSteps
// turns whatever we have into discrete steps for a numbered list: it prefers explicit line breaks,
// then falls back to inline "1." / "2)" numbering, then to sentence boundaries — and strips any
// leading marker so the UI owns the numbering.

const STEP_MARKER = /^\s*(?:step\s*)?\d{1,2}\s*[-.):]\s+|^\s*[-•*]\s+/i
const NUMBERED_SPLIT = /(?:(?<=\s)|^)\d{1,2}[.)]\s+/
const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z0-9])/

function stripMarker(s: string): string {
  return s.replace(STEP_MARKER, "").trim()
}

export function parseSteps(instructions: string | null | undefined): string[] {
  const text = (instructions ?? "").trim()
  if (!text) return []

  let parts = text
    .split(/\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean)

  // Single run-on line → try inline numbering, then sentence boundaries.
  if (parts.length <= 1) {
    const single = parts[0] ?? text
    const byNumber = single
      .split(NUMBERED_SPLIT)
      .map((s) => s.trim())
      .filter(Boolean)
    if (byNumber.length > 1) {
      parts = byNumber
    } else {
      const bySentence = single
        .split(SENTENCE_SPLIT)
        .map((s) => s.trim())
        .filter(Boolean)
      parts = bySentence.length > 1 ? bySentence : [single]
    }
  }

  return parts.map(stripMarker).filter(Boolean)
}
