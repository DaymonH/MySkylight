"use client"

import { useState } from "react"

// Deterministic (no Math.random) so a render is reproducible and never mismatches.
const COLORS = ["#f43f5e", "#f59e0b", "#10b981", "#3b82f6", "#a855f7", "#eab308"]
const PIECES = Array.from({ length: 30 }, (_, i) => ({
  left: (i * 37) % 100, // % across the card
  delay: ((i * 53) % 40) / 100, // 0–0.4s stagger
  drift: ((i * 29) % 120) - 60, // px sideways
  spin: ((i * 71) % 720) - 360, // deg
  color: COLORS[i % COLORS.length],
}))

/**
 * Confetti over a person's card the moment they finish their last chore. Render it
 * inside a `relative` container and pass whether everything is done: it bursts on the
 * not-done → done transition only, so a page that loads already complete stays calm.
 * Decorative, hidden from assistive tech, and silenced for reduced-motion (`.confetti-piece`).
 */
export function AllDoneCelebration({ active }: { active: boolean }) {
  const [wasActive, setWasActive] = useState(active)
  const [burst, setBurst] = useState(0)
  // Adjust state while rendering (React's documented alternative to an effect) so the
  // transition is caught without a cascading re-render.
  if (active !== wasActive) {
    setWasActive(active)
    if (active) setBurst((b) => b + 1)
  }
  if (!active || burst === 0) return null

  return (
    <div
      key={burst}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-3xl"
    >
      {PIECES.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={
            {
              left: `${p.left}%`,
              backgroundColor: p.color,
              "--d": `${p.delay}s`,
              "--x": `${p.drift}px`,
              "--r": `${p.spin}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}
