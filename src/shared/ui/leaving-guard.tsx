import { useIsPresent } from 'motion/react'
import { useLayoutEffect, useRef } from 'react'

/**
 * Content that is fading out is already gone for keyboard and assistive technology: `inert` plus
 * `aria-hidden`. Focus is moved out of the subtree first (e.g. the link that was just clicked),
 * otherwise the browser warns about `aria-hidden` on an element whose descendant retained focus.
 */
export function LeavingGuard({ children }: { children: React.ReactNode }) {
  const isPresent = useIsPresent()
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    if (isPresent) {
      element.removeAttribute('aria-hidden')
      return
    }
    if (document.activeElement instanceof HTMLElement && element.contains(document.activeElement)) {
      document.activeElement.blur()
    }
    element.setAttribute('aria-hidden', 'true')
  }, [isPresent])
  return (
    <div ref={ref} inert={!isPresent} className="contents">
      {children}
    </div>
  )
}
