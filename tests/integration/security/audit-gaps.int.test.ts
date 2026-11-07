import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it, inject } from 'vitest'

import type { Database } from '@/shared/api/database.types'

import { anonClient, createTestUser, type TestUser } from '../../setup/supabase'

// Direct Auth/REST/RPC requests that bypass the UI: anonymous sign-in, app_metadata through the
// user endpoint, spoofed RPC arguments, executor attempts to move/hand over his own task,
// visibility after reassignment, bursts of parallel transitions, a transition racing a reassignment
// and a role change taking effect for an already issued token.

type Status = Database['public']['Enums']['task_status']

let m1: TestUser
let e1: TestUser
let e2: TestUser
let objectId: string
let otherObjectId: string

async function createObject(prefix: string): Promise<string> {
  const { data, error } = await m1.client
    .from('objects')
    .insert({ name: `${prefix}-${crypto.randomUUID()}`, address: 'audit address' })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

async function createTask(assignee: TestUser, object = objectId): Promise<string> {
  const { data, error } = await m1.client
    .from('tasks')
    .insert({ object_id: object, title: 'audit-task', assignee_id: assignee.id })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

function change(user: TestUser, taskId: string, to: Status, comment?: string) {
  return user.client.rpc('change_task_status', {
    p_task_id: taskId,
    p_to_status: to,
    p_comment: comment,
  })
}

/** Ground truth read by the manager. */
async function taskState(taskId: string) {
  const { data, error } = await m1.client
    .from('tasks')
    .select('status, assignee_id, object_id')
    .eq('id', taskId)
    .single()
  if (error) throw error
  return data
}

async function history(taskId: string) {
  const { data, error } = await m1.client
    .from('task_status_history')
    .select('from_status, to_status, changed_by, comment')
    .eq('task_id', taskId)
    .order('id', { ascending: true })
  if (error) throw error
  return data
}

async function accessToken(user: TestUser): Promise<string> {
  const { data, error } = await user.client.auth.getSession()
  if (error) throw error
  if (!data.session) throw new Error('no session')
  return data.session.access_token
}

beforeAll(async () => {
  ;[m1, e1, e2] = await Promise.all([
    createTestUser('manager', 'aud-m1'),
    createTestUser('executor', 'aud-e1'),
    createTestUser('executor', 'aud-e2'),
  ])
  ;[objectId, otherObjectId] = await Promise.all([
    createObject('aud-object'),
    createObject('aud-other'),
  ])
})

describe('Auth API', () => {
  it('anonymous sign-in is disabled', async () => {
    const { data, error } = await anonClient().auth.signInAnonymously()
    expect(error).toMatchObject({ status: 422, code: 'anonymous_provider_disabled' })
    expect(data.session).toBeNull()
  })

  it('app_metadata cannot be written through the user endpoint (PUT /auth/v1/user)', async () => {
    const response = await fetch(`${inject('supabaseUrl')}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: inject('supabasePublishableKey'),
        Authorization: `Bearer ${await accessToken(e1)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ app_metadata: { app_role: 'manager' } }),
    })
    expect(response.status).toBe(403)
    const body = (await response.json()) as { error_code?: string }
    expect(body.error_code).toBe('not_admin')
    // Neither the token nor the database may carry a raised role afterwards.

    const refreshed = await e1.client.auth.refreshSession()
    expect(refreshed.error).toBeNull()
    expect(refreshed.data.user?.app_metadata.app_role).toBe('executor')

    const profile = await e1.client.from('profiles').select('role').eq('id', e1.id).single()
    expect(profile.data).toEqual({ role: 'executor' })

    const created = await e1.client
      .from('objects')
      .insert({ name: 'aud-escalated', address: 'x' })
      .select('id')
    expect(created.error).toMatchObject({ code: '42501' })
  })
})

describe('executor cannot move or hand over his own task', () => {
  let taskId: string
  beforeAll(async () => {
    taskId = await createTask(e1)
  })

  it('PATCH object_id → 42501', async () => {
    const { error, status } = await e1.client
      .from('tasks')
      .update({ object_id: otherObjectId })
      .eq('id', taskId)
    expect(error).toMatchObject({ code: '42501' })
    expect(status).toBe(403)
  })

  it('PATCH assignee_id to another executor → 0 rows', async () => {
    const { data, error } = await e1.client
      .from('tasks')
      .update({ assignee_id: e2.id })
      .eq('id', taskId)
      .select('id')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('upsert of the own task (id + new assignee) → 42501', async () => {
    const { error } = await e1.client
      .from('tasks')
      .upsert({ id: taskId, object_id: objectId, title: 'audit-task', assignee_id: e2.id })
    expect(error).toMatchObject({ code: '42501' })
  })

  it('state is unchanged', async () => {
    expect(await taskState(taskId)).toEqual({
      status: 'new',
      assignee_id: e1.id,
      object_id: objectId,
    })
  })
})

describe('history authorship cannot be spoofed through the RPC', () => {
  it('extra changed_by argument → PGRST202 (no such function), nothing written', async () => {
    const taskId = await createTask(e1)
    const response = await fetch(`${inject('supabaseUrl')}/rest/v1/rpc/change_task_status`, {
      method: 'POST',
      headers: {
        apikey: inject('supabasePublishableKey'),
        Authorization: `Bearer ${await accessToken(e1)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_task_id: taskId,
        p_to_status: 'in_progress',
        changed_by: m1.id,
        p_changed_by: m1.id,
      }),
    })
    expect(response.status).toBe(404)
    const body = (await response.json()) as { code?: string }
    expect(body.code).toBe('PGRST202')

    expect(await taskState(taskId)).toMatchObject({ status: 'new' })
    expect(await history(taskId)).toHaveLength(1)
  })

  it('a successful transition is attributed to the caller', async () => {
    const taskId = await createTask(e1)
    expect((await change(e1, taskId, 'in_progress')).error).toBeNull()
    expect((await history(taskId)).at(-1)).toMatchObject({
      from_status: 'new',
      to_status: 'in_progress',
      changed_by: e1.id,
    })
  })
})

describe('visibility follows reassignment (objects and history)', () => {
  it('E1 loses the object of his only task there, E2 gains it with the full history', async () => {
    const lonelyObject = await createObject('aud-lonely')
    const taskId = await createTask(e1, lonelyObject)
    expect((await change(e1, taskId, 'in_progress')).error).toBeNull()

    const before = await e1.client.from('objects').select('id').eq('id', lonelyObject)
    expect(before.data).toEqual([{ id: lonelyObject }])

    const reassigned = await m1.client
      .from('tasks')
      .update({ assignee_id: e2.id })
      .eq('id', taskId)
      .select('id')
    expect(reassigned.error).toBeNull()
    expect(reassigned.data).toEqual([{ id: taskId }])

    const e1Object = await e1.client.from('objects').select('id').eq('id', lonelyObject)
    expect(e1Object.error).toBeNull()
    expect(e1Object.data).toEqual([])
    const e1History = await e1.client.from('task_status_history').select('id').eq('task_id', taskId)
    expect(e1History.error).toBeNull()
    expect(e1History.data).toEqual([])

    const e2Object = await e2.client.from('objects').select('id').eq('id', lonelyObject)
    expect(e2Object.data).toEqual([{ id: lonelyObject }])
    const e2History = await e2.client.from('task_status_history').select('id').eq('task_id', taskId)
    expect(e2History.data).toHaveLength(2)
  })
})

describe('races', () => {
  it('8 parallel identical transitions: exactly one succeeds, exactly one history row', async () => {
    const taskId = await createTask(e1)
    const results = await Promise.all(
      Array.from({ length: 8 }, () => change(e1, taskId, 'in_progress')),
    )
    const errors = results.map((r) => r.error).filter((e) => e !== null)
    expect(errors).toHaveLength(7)
    for (const error of errors) {
      expect(error).toMatchObject({ code: 'P0001', message: 'transition_not_allowed' })
    }
    expect(await taskState(taskId)).toMatchObject({ status: 'in_progress' })
    expect(await history(taskId)).toEqual([
      { from_status: null, to_status: 'new', changed_by: m1.id, comment: null },
      { from_status: 'new', to_status: 'in_progress', changed_by: e1.id, comment: null },
    ])
  })

  it('transition by E1 racing a reassignment to E2: state and history stay consistent', async () => {
    const taskId = await createTask(e1)
    const [transition, reassignment] = await Promise.all([
      change(e1, taskId, 'in_progress'),
      m1.client.from('tasks').update({ assignee_id: e2.id }).eq('id', taskId).select('id'),
    ])
    expect(reassignment.error).toBeNull()
    expect(reassignment.data).toEqual([{ id: taskId }])

    const rows = await history(taskId)
    if (transition.error === null) {
      // Transition committed first (row lock), then the reassignment.
      expect(await taskState(taskId)).toMatchObject({ status: 'in_progress', assignee_id: e2.id })
      expect(rows).toHaveLength(2)
      expect(rows[1]).toMatchObject({
        from_status: 'new',
        to_status: 'in_progress',
        changed_by: e1.id,
      })
    } else {
      // Reassignment first: E1 no longer owns the task.
      expect(transition.error).toMatchObject({ code: 'P0001', message: 'task_not_found' })
      expect(await taskState(taskId)).toMatchObject({ status: 'new', assignee_id: e2.id })
      expect(rows).toHaveLength(1)
    }
  })
})

describe('role is read from the database on every request, not from the token', () => {
  it('a manager demoted by the admin loses manager rights with the same access token', async () => {
    const demoted = await createTestUser('manager', 'aud-demoted')
    const token = await accessToken(demoted)

    const admin = createClient<Database>(inject('supabaseUrl'), inject('supabaseSecretKey'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error: adminError } = await admin.auth.admin.updateUserById(demoted.id, {
      app_metadata: { app_role: 'executor' },
    })
    expect(adminError).toBeNull()

    // Same (not refreshed) session token as before the demotion.
    expect(await accessToken(demoted)).toBe(token)
    const created = await demoted.client
      .from('objects')
      .insert({ name: 'aud-demoted-object', address: 'x' })
      .select('id')
    expect(created.error).toMatchObject({ code: '42501' })

    const visible = await demoted.client.from('objects').select('id').eq('id', objectId)
    expect(visible.error).toBeNull()
    expect(visible.data).toEqual([])
  })
})
