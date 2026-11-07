import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { parseClientEnv } from '@/shared/config'

import type { Database } from './database.types'

let client: SupabaseClient<Database> | undefined

/** Lazily created singleton so tests and tooling can import modules without env. */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (!client) {
    const env = parseClientEnv(import.meta.env)
    client = createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY)
  }
  return client
}
