import { useEffect, useState } from 'react'

/** Pause after the last keystroke before a search is sent. */
export const SEARCH_DEBOUNCE_MS = 300

interface SearchState {
  globalFilter: string
  resetPage: () => void
}

/**
 * The search text that is actually sent to the server: the URL value after it stopped changing for
 * `delayMs` (the first render returns it as is). The list goes back to the first page in the same
 * update, so a request is made once, for the new search and page 1.
 */
export function useDebouncedSearch(
  { globalFilter, resetPage }: SearchState,
  delayMs = SEARCH_DEBOUNCE_MS,
): string {
  const [applied, setApplied] = useState(globalFilter)
  useEffect(() => {
    if (globalFilter === applied) return
    const timer = setTimeout(() => {
      setApplied(globalFilter)
      resetPage()
    }, delayMs)
    return () => {
      clearTimeout(timer)
    }
  }, [globalFilter, applied, resetPage, delayMs])
  return applied
}
