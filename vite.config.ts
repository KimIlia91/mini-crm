import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const HOSTED_SUPABASE_HTTPS = /https:\/\/[a-z0-9]+\.supabase\.co/g
const HOSTED_SUPABASE_WSS = /wss:\/\/[a-z0-9]+\.supabase\.co/g
const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321'

interface VercelHeader {
  key: string
  value: string
}

const vercelHeaders = (
  JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as {
    headers: { headers: VercelHeader[] }[]
  }
).headers.flatMap((rule) => rule.headers)

/**
 * Fails a Vercel build whose Supabase project is not allowed by the CSP `connect-src`: such a
 * deploy would block every auth, data and realtime request.
 */
function assertCspAllowsSupabase(supabaseUrl: string | undefined): void {
  const csp = vercelHeaders.find((header) => header.key === 'Content-Security-Policy')?.value ?? ''
  const origin = supabaseUrl ? new URL(supabaseUrl).origin : ''
  const wsOrigin = origin.replace(/^http/, 'ws')
  if (!origin || !csp.includes(` ${origin}`) || !csp.includes(` ${wsOrigin}`)) {
    throw new Error('vercel.json CSP connect-src does not allow VITE_SUPABASE_URL (https and wss)')
  }
}

/**
 * Security headers from vercel.json (single source of truth) for the local production preview:
 * the production Supabase origin is swapped for the local one the preview build talks to, and the
 * directives that only make sense over HTTPS are dropped.
 */
function previewSecurityHeaders(supabaseUrl: string): Record<string, string> {
  const localHttp = new URL(supabaseUrl).origin
  const localWs = localHttp.replace(/^http/, 'ws')
  const headers: Record<string, string> = {}
  for (const { key, value } of vercelHeaders) {
    if (key === 'Strict-Transport-Security') continue
    headers[key] = value
      .replace(HOSTED_SUPABASE_HTTPS, localHttp)
      .replace(HOSTED_SUPABASE_WSS, localWs)
      .replace('; upgrade-insecure-requests', '')
  }
  return headers
}

const env = loadEnv('production', process.cwd(), 'VITE_')
if (process.env.VERCEL) assertCspAllowsSupabase(env.VITE_SUPABASE_URL)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173, strictPort: true },
  preview: {
    port: 4173,
    strictPort: true,
    headers: previewSecurityHeaders(env.VITE_SUPABASE_URL ?? LOCAL_SUPABASE_URL),
  },
})
