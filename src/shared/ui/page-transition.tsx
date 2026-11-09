import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import { LeavingGuard } from './leaving-guard'

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]
const DURATION = 0.25
const SHIFT = 8

/**
 * Cross-page transition of the content area: the old page fades out (and moves a little), then the
 * new one fades in from the opposite side — never two pages in the flow at once. Changing
 * `transitionKey` starts it; the wrapper keeps the size of the area, so nothing jumps. `onEntered`
 * runs when the new page has finished appearing (not on the very first render).
 */
export function PageTransition({
  transitionKey,
  className,
  onEntered,
  onExited,
  children,
}: {
  transitionKey: string
  className?: string
  onEntered?: () => void
  onExited?: () => void
  children: React.ReactNode
}) {
  const reduce = useReducedMotion() === true
  const duration = reduce ? 0 : DURATION
  const shift = reduce ? 0 : SHIFT
  return (
    <AnimatePresence initial={false} mode="wait" onExitComplete={onExited}>
      <motion.div
        key={transitionKey}
        data-slot="page-transition"
        className={className}
        variants={{
          away: { opacity: 0, y: shift, transition: { duration, ease: EASE } },
          shown: { opacity: 1, y: 0, transition: { duration, ease: EASE } },
        }}
        initial="away"
        animate="shown"
        exit="away"
        onAnimationComplete={(definition) => {
          if (definition === 'shown') onEntered?.()
        }}
      >
        <LeavingGuard>{children}</LeavingGuard>
      </motion.div>
    </AnimatePresence>
  )
}
