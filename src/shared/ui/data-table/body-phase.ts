import { useState } from 'react'

/**
 * What the table body shows: `data` (rows or the empty block), `skeleton` rows, or `hold` — the first
 * load before the skeleton is due, when there is nothing to show yet (the body only keeps its height).
 */
export type BodyPhase = 'data' | 'skeleton' | 'hold'

/**
 * Fade-swap between body contents: the shown content fades out, is replaced while invisible, and the
 * new one fades in. `opacity` and `onFadeEnd` go to the animated body; `shown` says what to render.
 */
export function useBodyPhase(phase: BodyPhase): {
  shown: BodyPhase
  opacity: 0 | 1
  onFadeEnd: () => void
} {
  const [settled, setSettled] = useState(phase)
  // Nothing visible is left in `hold`, so leaving it needs no fade-out.
  const shown = settled === 'hold' ? phase : settled
  const opacity = phase === 'hold' || shown !== phase ? 0 : 1
  return {
    shown,
    opacity,
    onFadeEnd: () => {
      if (settled !== phase) setSettled(phase)
    },
  }
}
