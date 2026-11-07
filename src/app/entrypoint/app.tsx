import { QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { useState } from 'react'
import { RouterProvider } from 'react-router/dom'

import { ThemeProvider } from '@/shared/theme'

import '../i18n'
import { router } from '../routes/router'
import { createQueryClient } from './query-client'
import { SessionProvider } from './session-provider'

export function App() {
  const [queryClient] = useState(createQueryClient)
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <MotionConfig reducedMotion="user">
            <RouterProvider router={router} useTransitions={false} />
          </MotionConfig>
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
