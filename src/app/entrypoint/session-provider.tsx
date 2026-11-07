import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'

import { subscribeToAuthChanges } from '@/shared/api'
import { SessionContext, type SessionState } from '@/shared/auth'
import { clearListStates } from '@/shared/lib'

const LOADING: SessionState = { status: 'loading', userId: null }

/**
 * Mirrors the auth session into context and drops every cached query on sign-out
 * or user change, so one user's data is never shown to another.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<SessionState>(LOADING)

  useEffect(() => {
    let previousUserId: string | null = null
    return subscribeToAuthChanges((event, userId) => {
      if (event === 'SIGNED_OUT' || (previousUserId !== null && previousUserId !== userId)) {
        queryClient.clear()
        clearListStates()
      }
      previousUserId = userId
      setSession((current) =>
        current.userId === userId && current.status !== 'loading'
          ? current
          : userId === null
            ? { status: 'signed-out', userId: null }
            : { status: 'signed-in', userId },
      )
    })
  }, [queryClient])

  return <SessionContext value={session}>{children}</SessionContext>
}
