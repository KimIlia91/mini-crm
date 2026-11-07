import type { TestProject } from 'vitest/node'

import { getLocalSupabaseAdminEnv, getLocalSupabaseEnv } from '../../scripts/supabase-env.mjs'

declare module 'vitest' {
  export interface ProvidedContext {
    supabaseUrl: string
    supabasePublishableKey: string
    // Local-stack secret key, node-only. Provided in memory (never env/files/logs).
    supabaseSecretKey: string
  }
}

/** Resolves the LOCAL Supabase stack once and provides it to integration tests. Fails fast if it is down. */
export default function setup(project: TestProject) {
  const { url, publishableKey } = getLocalSupabaseEnv()
  const { secretKey } = getLocalSupabaseAdminEnv()
  project.provide('supabaseUrl', url)
  project.provide('supabasePublishableKey', publishableKey)
  project.provide('supabaseSecretKey', secretKey)
}
