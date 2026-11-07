import { z } from 'zod'

/** Reads `role` from a JWT payload; null if the token is not a parsable JWT. */
function readJwtRole(token: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    // base64url -> base64 (+ padding) so atob accepts it.
    const base64 = (parts[1] ?? '').replaceAll('-', '+').replaceAll('_', '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (typeof payload === 'object' && payload !== null && 'role' in payload) {
      return typeof payload.role === 'string' ? payload.role : null
    }
    return null
  } catch {
    return null
  }
}

/**
 * Allow-list, not deny-list (so any privileged JWT is refused without being named): the key must be a publishable key or a legacy anon JWT.
 * A malformed JWT-like value is rejected too: we cannot prove it is not privileged,
 * and a broken key is useless to the app anyway (Fail Fast).
 */
function checkBrowserSafeKey(key: string, ctx: z.RefinementCtx): void {
  if (key.startsWith('sb_secret_')) {
    ctx.addIssue({ code: 'custom', message: 'Secret keys must never be used in the browser' })
    return
  }
  if (key.startsWith('sb_publishable_')) return
  if (readJwtRole(key) === 'anon') return
  ctx.addIssue({ code: 'custom', message: 'Key must be a publishable or anon key' })
}

/**
 * Client-side environment. Only VITE_* variables are exposed to the browser.
 * Never put privileged (secret / service-role) keys here: anything in import.meta.env ships to the client.
 */
const envSchema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).superRefine(checkBrowserSafeKey),
})

export type ClientEnv = z.infer<typeof envSchema>

export function parseClientEnv(source: Record<string, unknown>): ClientEnv {
  const result = envSchema.safeParse(source)
  if (!result.success) {
    throw new Error(`Invalid client environment: ${z.prettifyError(result.error)}`)
  }
  return result.data
}
