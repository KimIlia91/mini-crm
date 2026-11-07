import { createContext, use } from 'react'

export type SessionState =
  | { status: 'loading'; userId: null }
  | { status: 'signed-in'; userId: string }
  | { status: 'signed-out'; userId: null }

export const SessionContext = createContext<SessionState | null>(null)

export function useSession(): SessionState {
  const session = use(SessionContext)
  if (!session) throw new Error('useSession must be used inside a SessionProvider')
  return session
}
