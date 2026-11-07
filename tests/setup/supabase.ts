import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { inject } from 'vitest'

import type { Database } from '@/shared/api/database.types'

export type AppRole = 'manager' | 'executor'

const authOptions = { auth: { persistSession: false, autoRefreshToken: false } }

/** New client with the publishable key and no persisted session (no state shared between tests). */
export function anonClient(): SupabaseClient<Database> {
  return createClient<Database>(
    inject('supabaseUrl'),
    inject('supabasePublishableKey'),
    authOptions,
  )
}

/** Admin client (secret key) for test setup only; the key is held in memory and never printed. */
function adminClient(): SupabaseClient<Database> {
  return createClient<Database>(inject('supabaseUrl'), inject('supabaseSecretKey'), authOptions)
}

export interface TestUser {
  id: string
  email: string
  role: AppRole
  /** Current password (the new one if it was changed on first login). */
  password: string
  client: SupabaseClient<Database>
}

export interface CreateTestUserOptions {
  /** Change the initial password after sign-in (clears must_change_password). Default: true. */
  changePassword?: boolean
}

/**
 * Creates a unique confirmed user with the given app role through the local admin API
 * (open sign-up is disabled), signs in with a publishable-key client and, by default,
 * completes the mandatory first-login password change.
 */
export async function createTestUser(
  role: AppRole,
  prefix = 'user',
  { changePassword = true }: CreateTestUserOptions = {},
): Promise<TestUser> {
  const email = `${prefix}-${crypto.randomUUID()}@example.test`
  let password = `Pw-${crypto.randomUUID()}`
  const { data: created, error: createError } = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { app_role: role },
  })
  if (createError) throw createError

  const client = anonClient()
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  if (data.user.id !== created.user.id) throw new Error('signIn resolved a different user')

  if (changePassword) {
    const newPassword = `Pw-${crypto.randomUUID()}`
    const { error: updateError } = await client.auth.updateUser({ password: newPassword })
    if (updateError) throw updateError
    password = newPassword
  }
  return { id: created.user.id, email, role, password, client }
}
