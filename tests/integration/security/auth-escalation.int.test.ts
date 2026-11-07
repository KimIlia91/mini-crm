import { beforeAll, describe, expect, it, inject } from 'vitest'

import { createTestUser, type TestUser } from '../../setup/supabase'

// Escalation attempts through the Auth API and the Data API, made with the user's own session
// (publishable key). The role and the forced-password flag must be controlled by the database only.

async function ownProfile(user: TestUser) {
  const { data, error } = await user.client
    .from('profiles')
    .select('role, must_change_password')
    .eq('id', user.id)
    .single()
  if (error) throw error
  return data
}

async function accessToken(user: TestUser): Promise<string> {
  const { data, error } = await user.client.auth.getSession()
  if (error) throw error
  if (!data.session) throw new Error('no session')
  return data.session.access_token
}

describe('role cannot be raised through the Auth API', () => {
  let executor: TestUser
  beforeAll(async () => {
    executor = await createTestUser('executor', 'esc-e')
  })

  it('user_metadata app_role/role is ignored: profile role and app_metadata stay executor', async () => {
    const { error } = await executor.client.auth.updateUser({
      data: { app_role: 'manager', role: 'manager' },
    })
    expect(error).toBeNull()

    // A refreshed token must not carry a raised app_metadata either.
    const refreshed = await executor.client.auth.refreshSession()
    expect(refreshed.error).toBeNull()
    expect(refreshed.data.user?.app_metadata.app_role).toBe('executor')

    expect(await ownProfile(executor)).toEqual({ role: 'executor', must_change_password: false })

    const created = await executor.client
      .from('objects')
      .insert({ name: 'esc-object', address: 'x' })
      .select('id')
    expect(created.error).toMatchObject({ code: '42501' })
  })
})

describe('forced password change cannot be skipped', () => {
  let fresh: TestUser
  beforeAll(async () => {
    fresh = await createTestUser('manager', 'esc-fresh', { changePassword: false })
  })

  it('re-submitting the current password is rejected and keeps the flag', async () => {
    const { error } = await fresh.client.auth.updateUser({ password: fresh.password })
    expect(error).toMatchObject({ code: 'same_password' })
    expect(await ownProfile(fresh)).toEqual({ role: 'manager', must_change_password: true })
  })

  it('user_metadata must_change_password=false does not clear the flag', async () => {
    const { error } = await fresh.client.auth.updateUser({ data: { must_change_password: false } })
    expect(error).toBeNull()
    expect(await ownProfile(fresh)).toEqual({ role: 'manager', must_change_password: true })
  })

  it('a weak new password is rejected and keeps the flag', async () => {
    const { error } = await fresh.client.auth.updateUser({ password: 'password' })
    expect(error).toMatchObject({ code: 'weak_password' })
    expect(await ownProfile(fresh)).toEqual({ role: 'manager', must_change_password: true })
  })
})

describe('private schema is not reachable through the Data API', () => {
  let executor: TestUser
  beforeAll(async () => {
    executor = await createTestUser('executor', 'esc-priv')
  })

  it.each(['change_task_status', 'current_app_role'])(
    'POST /rpc/%s with private profile → rejected',
    async (fn) => {
      const response = await fetch(`${inject('supabaseUrl')}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: {
          apikey: inject('supabasePublishableKey'),
          Authorization: `Bearer ${await accessToken(executor)}`,
          'Content-Profile': 'private',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          fn === 'change_task_status'
            ? { p_task_id: crypto.randomUUID(), p_to_status: 'in_progress' }
            : {},
        ),
      })
      expect(response.ok).toBe(false)
      const body = (await response.json()) as { code?: string }
      expect(body.code).toBe('PGRST106')
    },
  )
})
