import { useIsPresent } from 'motion/react'
import { useCallback } from 'react'
import { useSearchParams, type SetURLSearchParams } from 'react-router'

/**
 * `useSearchParams` for URL state of a page. A page that is fading out stays mounted with a frozen
 * location while the router already shows the next one, so any write it makes (a debounce timer,
 * a page clamp) would land in the URL of the page being opened. Its setter does nothing then.
 */
export function useLiveSearchParams(): [URLSearchParams, SetURLSearchParams] {
  const [searchParams, setSearchParams] = useSearchParams()
  const isPresent = useIsPresent()
  const setLive = useCallback<SetURLSearchParams>(
    (next, options) => {
      if (isPresent) setSearchParams(next, options)
    },
    [isPresent, setSearchParams],
  )
  return [searchParams, setLive]
}
