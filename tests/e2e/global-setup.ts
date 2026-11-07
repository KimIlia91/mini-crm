/** Fails the E2E run early (before browsers start) when the local Supabase stack is unavailable. */
export default function globalSetup(): void {
  const error = process.env.E2E_SUPABASE_ERROR
  if (error || !process.env.E2E_SUPABASE_URL) {
    throw new Error(`E2E requires the local Supabase stack: ${error ?? 'not configured'}`)
  }
}
