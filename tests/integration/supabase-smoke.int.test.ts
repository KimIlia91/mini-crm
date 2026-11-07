import { describe, expect, it } from 'vitest'

import { anonClient, createTestUser } from '../setup/supabase'

describe('local Supabase (infrastructure smoke)', () => {
  it('creates a real user via the admin API and resolves the same identity from the JWT', async () => {
    const user = await createTestUser('manager', 'smoke')
    const { data, error } = await user.client.auth.getUser()
    expect(error).toBeNull()
    expect(data.user?.id).toBe(user.id)
    expect(data.user?.role).toBe('authenticated')
  })

  it('isolates sessions between concurrently created users', async () => {
    const [a, b] = await Promise.all([
      createTestUser('manager', 'a'),
      createTestUser('executor', 'b'),
    ])
    expect(a.id).not.toBe(b.id)
    const { data } = await a.client.auth.getUser()
    expect(data.user?.id).toBe(a.id)
  })

  it('rejects open sign-up with the publishable key and issues no session', async () => {
    const { data, error } = await anonClient().auth.signUp({
      email: `signup-${crypto.randomUUID()}@example.test`,
      password: `Pw-${crypto.randomUUID()}`,
    })
    expect(error).toMatchObject({ status: 422, code: 'signup_disabled' })
    expect(data.user).toBeNull()
    expect(data.session).toBeNull()
  })

  it('denies admin APIs to a publishable (client) key', async () => {
    const { data, error } = await anonClient().auth.admin.listUsers()
    expect(error).toMatchObject({ status: 403, code: 'not_admin' })
    expect(data.users).toEqual([])
  })

  it('does not expose the private schema through the Data API', async () => {
    // `private` is not in Database, so the typed client rejects it; this directive also guards
    // the typing: if Database stops being applied, it becomes unused and typecheck fails.
    const query = anonClient()
      // @ts-expect-error 'private' is not an exposed schema in the generated Database type
      .schema('private')
    // @ts-expect-error no relation is typed in a schema that is not in Database
    const request = query.from('anything').select('*').limit(1)
    const { data, error, status } = await request
    expect(status).toBe(406)
    expect(error).toMatchObject({ code: 'PGRST106', message: 'Invalid schema: private' })
    expect(data).toBeNull()
  })
})
