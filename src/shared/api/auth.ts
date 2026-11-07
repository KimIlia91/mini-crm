import type { AuthChangeEvent } from '@supabase/supabase-js'

import { getSupabaseClient } from './supabase-client'

export type AuthEvent = AuthChangeEvent

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabaseClient().auth.signOut()
  if (error) throw error
}

/**
 * The listener runs inside the auth lock: it must be synchronous and must not
 * await any Supabase call. Returns the unsubscribe function.
 */
export function subscribeToAuthChanges(
  listener: (event: AuthEvent, userId: string | null) => void,
): () => void {
  const { data } = getSupabaseClient().auth.onAuthStateChange((event, session) => {
    listener(event, session?.user.id ?? null)
  })
  return () => {
    data.subscription.unsubscribe()
  }
}

export async function updatePassword(newPassword: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.updateUser({ password: newPassword })
  if (error) throw error
}

/** Machine-readable auth error code (`invalid_credentials`, `same_password`, `weak_password`, ...). */
export function getAuthErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return typeof error.code === 'string' ? error.code : undefined
  }
  return undefined
}
