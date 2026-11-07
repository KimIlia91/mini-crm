/// <reference lib="dom" />
import AxeBuilder from '@axe-core/playwright'
import { test as base, expect, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { getLocalSupabaseAdminEnv } from '../../scripts/supabase-env.mjs'
import type { Database } from '../../src/shared/api/database.types'

/** Lets finite CSS/Web animations (sheet, dialog, menu transitions) end, so colours are final. */
export async function settleAnimations(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
    await Promise.allSettled(finite.map((animation) => animation.finished))
  })
}

export async function expectNoA11yViolations(page: Page): Promise<void> {
  // Contrast is computed from the rendered colours: a half-faded overlay would give false results.
  await settleAnimations(page)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  )
  const blocking = serious.map(
    (v) => `${v.id} (${v.impact ?? 'n/a'}): ${v.help} — ${v.nodes.length} node(s)`,
  )
  const nodes = serious.flatMap((v) => v.nodes.map((n) => n.html))
  expect(blocking, `${blocking.join(' | ')}\n${nodes.join('\n')}`).toEqual([])
}

const authOptions = { auth: { persistSession: false, autoRefreshToken: false } }

type AdminEnv = ReturnType<typeof getLocalSupabaseAdminEnv>
let adminEnv: AdminEnv | undefined

/** Secret key is read lazily, in node only (never process.env / webServer env / logs). */
function adminClient(): SupabaseClient<Database> {
  adminEnv ??= getLocalSupabaseAdminEnv()
  return createClient<Database>(adminEnv.url, adminEnv.secretKey, authOptions)
}

function publishableClient(): SupabaseClient<Database> {
  const url = process.env.E2E_SUPABASE_URL
  const key = process.env.E2E_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) throw new Error('E2E Supabase env is not configured')
  return createClient<Database>(url, key, authOptions)
}

export type AppRole = 'manager' | 'executor'

export interface E2EUser {
  id: string
  email: string
  password: string
  fullName: string
  role: AppRole
  /** Client signed in as this user (active users only) — test data setup through the RLS-bound API. */
  client: SupabaseClient<Database>
}

/**
 * Creates a unique confirmed user through the local admin API. With `active: true` (default) the
 * mandatory first-login password change is completed, so the user lands in the app on login.
 */
export async function createUser(
  role: AppRole,
  label: string,
  { active = true }: { active?: boolean } = {},
): Promise<E2EUser> {
  const id = crypto.randomUUID()
  const email = `e2e-${label}-${id}@example.test`
  const fullName = `${label} ${id.slice(0, 8)}`
  let password = `Pw-${crypto.randomUUID()}`
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { app_role: role },
    user_metadata: { full_name: fullName },
  })
  if (error) throw error

  const client = publishableClient()
  if (active) {
    const signIn = await client.auth.signInWithPassword({ email, password })
    if (signIn.error) throw signIn.error
    const next = `Pw-${crypto.randomUUID()}`
    const update = await client.auth.updateUser({ password: next })
    if (update.error) throw update.error
    password = next
  }
  return { id: data.user.id, email, password, fullName, role, client }
}

export async function createObject(
  manager: E2EUser,
  name: string,
  address = 'Адрес e2e',
): Promise<string> {
  const { data, error } = await manager.client
    .from('objects')
    .insert({ name, address })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function createTask(
  manager: E2EUser,
  objectId: string,
  assignee: E2EUser,
  title: string,
  description = '',
): Promise<string> {
  const { data, error } = await manager.client
    .from('tasks')
    .insert({ object_id: objectId, title, description, assignee_id: assignee.id })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

/** Signs in through the login form. */
export async function login(
  page: Page,
  user: Pick<E2EUser, 'email' | 'password'>,
  { expectSuccess = true }: { expectSuccess?: boolean } = {},
): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Пароль').fill(user.password)
  await page.getByRole('button', { name: 'Войти' }).click()
  // Password sign-in is bcrypt-bound: with every worker creating and signing in users at once the
  // local auth server answered /token in up to ~2.8 s (browser-observed ~4.9 s with the gateway),
  // measured 2026-11-07. A real single user waits ~150 ms; this only absorbs parallel-run load.
  if (expectSuccess) await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
}

export const test = base.extend<{ supabaseUrl: string; supabasePublishableKey: string }>({
  supabaseUrl: [process.env.E2E_SUPABASE_URL ?? '', { option: true }],
  supabasePublishableKey: [process.env.E2E_SUPABASE_PUBLISHABLE_KEY ?? '', { option: true }],
})

export { expect }
