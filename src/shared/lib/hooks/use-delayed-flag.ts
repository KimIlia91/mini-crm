import { useEffect, useState } from 'react'

/** Loaders and skeletons appear only after this long: a fast response never flashes them. */
export const LOADER_DELAY_MS = 200

/**
 * True once `active` has stayed true for `delayMs` without a break; false at once when it ends.
 */
export function useDelayedFlag(active: boolean, delayMs: number = LOADER_DELAY_MS): boolean {
  const [elapsed, setElapsed] = useState(false)
  if (!active && elapsed) setElapsed(false)
  useEffect(() => {
    if (!active) return undefined
    const timer = setTimeout(() => {
      setElapsed(true)
    }, delayMs)
    return () => {
      clearTimeout(timer)
    }
  }, [active, delayMs])
  return active && elapsed
}
