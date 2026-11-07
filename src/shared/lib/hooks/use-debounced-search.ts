import { useEffect, useState } from 'react'

/** Pause after the last keystroke before a search is sent. */
export const SEARCH_DEBOUNCE_MS = 300

/**
 * The search text that is actually sent to the server: the URL value after it stopped changing for
 * `delayMs` (the first render returns it as is). It only delays the request and never writes to
 * the URL: the page is reset when the search text changes (`onGlobalFilterChange`), so a page
 * chosen while the search is pending stays, even if this page is fading out or coming back.
 */
export function useDebouncedSearch(
  { globalFilter }: { globalFilter: string },
  delayMs = SEARCH_DEBOUNCE_MS,
): string {
  const [applied, setApplied] = useState(globalFilter)
  useEffect(() => {
    if (globalFilter === applied) return
    const timer = setTimeout(() => {
      setApplied(globalFilter)
    }, delayMs)
    return () => {
      clearTimeout(timer)
    }
  }, [globalFilter, applied, delayMs])
  return applied
}
