import { motion, useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'

import { useDelayedFlag } from '@/shared/lib'

import { Spinner } from './spinner'

/**
 * Loader for a screen whose data is not there yet. The area holds its height from the first frame;
 * the spinner and its text appear only after a short delay (a fast response shows nothing) and
 * fade in.
 */
export function PageLoader() {
  const { t } = useTranslation('common')
  const reduce = useReducedMotion() === true
  const visible = useDelayedFlag(true)
  return (
    // The live region exists from the first frame and is not inside an `aria-busy` element (that
    // would suppress announcements); the text arrives with the delayed fade-in.
    <div role="status" className="flex min-h-64 flex-1 items-center justify-center">
      {visible ? (
        <motion.div
          className="flex items-center gap-2 text-muted-foreground"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: reduce ? 0 : 0.25, ease: 'easeOut' } }}
        >
          <Spinner aria-hidden="true" role={undefined} aria-label={undefined} />
          {t('loading')}
        </motion.div>
      ) : null}
    </div>
  )
}
