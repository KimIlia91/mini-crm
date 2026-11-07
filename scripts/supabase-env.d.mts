export interface LocalSupabaseEnv {
  url: string
  publishableKey: string
}

export interface LocalSupabaseAdminEnv {
  url: string
  secretKey: string
}

export function getLocalSupabaseEnv(): LocalSupabaseEnv
export function getLocalSupabaseAdminEnv(): LocalSupabaseAdminEnv
