import { useMediaQuery } from './use-media-query'

const MOBILE_BREAKPOINT = 768

/** True below the `md` breakpoint; follows viewport changes without effects. */
export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${String(MOBILE_BREAKPOINT - 1)}px)`)
}
