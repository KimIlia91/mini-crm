import { defineConfig, devices } from '@playwright/test'

import { getLocalSupabaseEnv } from './scripts/supabase-env.mjs'

// E2E runs against the REAL local Supabase stack (npm run db:start). The lookup is tolerant here so
// that `--list` / `show-report` work without Docker; tests/e2e/global-setup.ts fails fast instead.
let supabase: { url: string; publishableKey: string } | null = null
try {
  supabase = getLocalSupabaseEnv()
  process.env.E2E_SUPABASE_URL = supabase.url
  process.env.E2E_SUPABASE_PUBLISHABLE_KEY = supabase.publishableKey
} catch (error) {
  process.env.E2E_SUPABASE_ERROR = error instanceof Error ? error.message : String(error)
}

const PORT = 4173
const baseURL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: ['./tests/e2e/global-setup.ts', './tests/setup/clean-test-data.global-setup.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Browsers, the preview server and the whole Supabase stack share one machine. With the default
  // (half the cores) sign-in and REST answers reached 3–5 s and screens missed their 5 s budget;
  // 4 workers keep the run reproducible (measured 2026-11-07).
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    // Production build served by `vite preview` — closer to what users get than the dev server.
    command: `npx vite build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: supabase?.url ?? 'http://127.0.0.1:54321',
      VITE_SUPABASE_PUBLISHABLE_KEY: supabase?.publishableKey ?? 'sb_publishable_unavailable',
    },
  },
})
