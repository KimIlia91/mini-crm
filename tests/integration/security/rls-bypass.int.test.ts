import { beforeAll, describe, expect, it } from 'vitest'

import { anonClient, createTestUser, type TestUser } from '../../setup/supabase'

// Direct Data API requests (REST/RPC) that bypass the UI. Every rule must hold in the database.
// Users are unique per run; assertions only touch rows created here (no global counts).

let m1: TestUser
let m2: TestUser
let e1: TestUser
let e2: TestUser
let objectId: string

async function createTask(assignee: TestUser, title = 'sec-task'): Promise<string> {
  const { data, error } = await m1.client
    .from('tasks')
    .insert({ object_id: objectId, title, assignee_id: assignee.id })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

/** Ground truth read by a manager (sees everything), to prove that a denied request changed nothing. */
async function taskState(taskId: string) {
  const { data, error } = await m1.client
    .from('tasks')
    .select('title, status, assignee_id, author_id')
    .eq('id', taskId)
    .single()
  if (error) throw error
  return data
}

async function historyCount(taskId: string): Promise<number> {
  const { count, error } = await m1.client
    .from('task_status_history')
    .select('id', { count: 'exact', head: true })
    .eq('task_id', taskId)
  if (error) throw error
  return count ?? -1
}

beforeAll(async () => {
  ;[m1, m2, e1, e2] = await Promise.all([
    createTestUser('manager', 'sec-m1'),
    createTestUser('manager', 'sec-m2'),
    createTestUser('executor', 'sec-e1'),
    createTestUser('executor', 'sec-e2'),
  ])
  const { data, error } = await m1.client
    .from('objects')
    .insert({ name: `sec-object-${crypto.randomUUID()}`, address: 'sec address' })
    .select('id')
    .single()
  if (error) throw error
  objectId = data.id
})

describe('executor cannot reach another executor’s task (E2 → task of E1)', () => {
  let taskId: string
  beforeAll(async () => {
    taskId = await createTask(e1)
  })

  it('select by id returns nothing', async () => {
    const { data, error } = await e2.client.from('tasks').select('id').eq('id', taskId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('cannot read its history or its object', async () => {
    const history = await e2.client.from('task_status_history').select('id').eq('task_id', taskId)
    expect(history.error).toBeNull()
    expect(history.data).toEqual([])
    const object = await e2.client.from('objects').select('id').eq('id', objectId)
    expect(object.error).toBeNull()
    expect(object.data).toEqual([])
  })

  it('update affects 0 rows and changes nothing', async () => {
    const { data, error } = await e2.client
      .from('tasks')
      .update({ title: 'hacked', assignee_id: e2.id })
      .eq('id', taskId)
      .select('id')
    expect(error).toBeNull()
    expect(data).toEqual([])
    expect(await taskState(taskId)).toMatchObject({ title: 'sec-task', assignee_id: e1.id })
  })

  it('client DELETE → 42501 and the task survives', async () => {
    const { data, error, status } = await e2.client.from('tasks').delete().eq('id', taskId)
    expect(error).toMatchObject({ code: '42501' })
    expect(status).toBe(403)
    expect(data).toBeNull()
    expect(await taskState(taskId)).toMatchObject({ status: 'new' })
  })

  it('RPC change_task_status → task_not_found, same as for a non-existent id', async () => {
    const foreign = await e2.client.rpc('change_task_status', {
      p_task_id: taskId,
      p_to_status: 'in_progress',
    })
    expect(foreign.error).toMatchObject({ code: 'P0001', message: 'task_not_found' })

    const missing = await e2.client.rpc('change_task_status', {
      p_task_id: crypto.randomUUID(),
      p_to_status: 'in_progress',
    })
    expect(missing.error).toMatchObject({ code: 'P0001', message: 'task_not_found' })

    expect(await taskState(taskId)).toMatchObject({ status: 'new' })
    expect(await historyCount(taskId)).toBe(1)
  })
})

describe('executor on his own task: only the transition API works', () => {
  let taskId: string
  beforeAll(async () => {
    taskId = await createTask(e1)
  })

  it('direct status update → 42501', async () => {
    const { data, error, status } = await e1.client
      .from('tasks')
      .update({ status: 'in_review' })
      .eq('id', taskId)
      .select('id')
    expect(error).toMatchObject({ code: '42501' })
    expect(status).toBe(403)
    expect(data).toBeNull()
    expect(await taskState(taskId)).toMatchObject({ status: 'new' })
  })

  it('title update affects 0 rows, client DELETE → 42501', async () => {
    const updated = await e1.client
      .from('tasks')
      .update({ title: 'mine now' })
      .eq('id', taskId)
      .select('id')
    expect(updated.error).toBeNull()
    expect(updated.data).toEqual([])

    const deleted = await e1.client.from('tasks').delete().eq('id', taskId)
    expect(deleted.error).toMatchObject({ code: '42501' })
    expect(deleted.status).toBe(403)

    expect(await taskState(taskId)).toMatchObject({ title: 'sec-task', status: 'new' })
  })

  it('cannot create a task (even assigned to himself) → 42501', async () => {
    const { data, error } = await e1.client
      .from('tasks')
      .insert({ object_id: objectId, title: 'sec-e1-insert', assignee_id: e1.id })
      .select('id')
    expect(error).toMatchObject({ code: '42501' })
    expect(data).toBeNull()
  })

  it('cannot forge, rewrite or delete history → 42501, history intact', async () => {
    const forged = await e1.client.from('task_status_history').insert({
      task_id: taskId,
      from_status: 'in_review',
      to_status: 'accepted',
      changed_by: m1.id,
    })
    expect(forged.error).toMatchObject({ code: '42501' })

    const rewritten = await e1.client
      .from('task_status_history')
      .update({ comment: 'rewritten' })
      .eq('task_id', taskId)
    expect(rewritten.error).toMatchObject({ code: '42501' })

    const deleted = await e1.client.from('task_status_history').delete().eq('task_id', taskId)
    expect(deleted.error).toMatchObject({ code: '42501' })

    const { data, error } = await m1.client
      .from('task_status_history')
      .select('from_status, to_status, changed_by, comment')
      .eq('task_id', taskId)
    expect(error).toBeNull()
    expect(data).toEqual([
      { from_status: null, to_status: 'new', changed_by: m1.id, comment: null },
    ])
  })

  it('forbidden transitions via RPC → transition_not_allowed', async () => {
    const skip = await e1.client.rpc('change_task_status', {
      p_task_id: taskId,
      p_to_status: 'accepted',
    })
    expect(skip.error).toMatchObject({ code: 'P0001', message: 'transition_not_allowed' })

    const managerTakes = await m1.client.rpc('change_task_status', {
      p_task_id: taskId,
      p_to_status: 'in_progress',
    })
    expect(managerTakes.error).toMatchObject({ code: 'P0001', message: 'transition_not_allowed' })

    expect(await taskState(taskId)).toMatchObject({ status: 'new' })
    expect(await historyCount(taskId)).toBe(1)
  })

  it('replayed transition request is rejected and writes no second history row', async () => {
    const replayTask = await createTask(e1, 'sec-replay')
    const args = { p_task_id: replayTask, p_to_status: 'in_progress' as const }

    const first = await e1.client.rpc('change_task_status', args)
    expect(first.error).toBeNull()
    const replay = await e1.client.rpc('change_task_status', args)
    expect(replay.error).toMatchObject({ code: 'P0001', message: 'transition_not_allowed' })

    expect(await taskState(replayTask)).toMatchObject({ status: 'in_progress' })
    expect(await historyCount(replayTask)).toBe(2)
  })
})

describe('manager cannot bypass server-controlled columns', () => {
  it('direct status update → 42501', async () => {
    const taskId = await createTask(e1)
    const { error, status } = await m1.client
      .from('tasks')
      .update({ status: 'accepted' })
      .eq('id', taskId)
    expect(error).toMatchObject({ code: '42501' })
    expect(status).toBe(403)
    expect(await taskState(taskId)).toMatchObject({ status: 'new' })
  })

  it('insert with a foreign author_id → 42501', async () => {
    const { data, error } = await m1.client
      .from('tasks')
      .insert({
        object_id: objectId,
        title: 'sec-forged-author',
        assignee_id: e1.id,
        author_id: m2.id,
      })
      .select('id')
    expect(error).toMatchObject({ code: '42501' })
    expect(data).toBeNull()
  })

  it('insert with an explicit status → 42501', async () => {
    const { data, error } = await m1.client
      .from('tasks')
      .insert({
        object_id: objectId,
        title: 'sec-forged-status',
        assignee_id: e1.id,
        status: 'accepted',
      })
      .select('id')
    expect(error).toMatchObject({ code: '42501' })
    expect(data).toBeNull()
  })

  it('positive control: the database sets author and status', async () => {
    const taskId = await createTask(e1)
    expect(await taskState(taskId)).toMatchObject({ status: 'new', author_id: m1.id })
  })
})

describe('user who has not changed the initial password gets no access', () => {
  let freshManager: TestUser
  let freshExecutor: TestUser
  let taskId: string
  beforeAll(async () => {
    ;[freshManager, freshExecutor] = await Promise.all([
      createTestUser('manager', 'sec-fresh-m', { changePassword: false }),
      createTestUser('executor', 'sec-fresh-e', { changePassword: false }),
    ])
    taskId = await createTask(freshExecutor, 'sec-fresh-task')
  })

  it('reads own profile with must_change_password = true', async () => {
    const { data, error } = await freshManager.client
      .from('profiles')
      .select('id, must_change_password')
      .eq('id', freshManager.id)
      .single()
    expect(error).toBeNull()
    expect(data).toEqual({ id: freshManager.id, must_change_password: true })
  })

  it('manager role sees no objects or tasks and cannot create objects', async () => {
    const objects = await freshManager.client.from('objects').select('id').eq('id', objectId)
    expect(objects.error).toBeNull()
    expect(objects.data).toEqual([])

    const tasks = await freshManager.client.from('tasks').select('id').eq('id', taskId)
    expect(tasks.error).toBeNull()
    expect(tasks.data).toEqual([])

    const created = await freshManager.client
      .from('objects')
      .insert({ name: 'sec-fresh-object', address: 'x' })
      .select('id')
    expect(created.error).toMatchObject({ code: '42501' })
  })

  it('executor does not see the task assigned to him and cannot change its status', async () => {
    const tasks = await freshExecutor.client.from('tasks').select('id').eq('id', taskId)
    expect(tasks.error).toBeNull()
    expect(tasks.data).toEqual([])

    const rpc = await freshExecutor.client.rpc('change_task_status', {
      p_task_id: taskId,
      p_to_status: 'in_progress',
    })
    expect(rpc.error).toMatchObject({ code: 'P0001' })
    expect(await taskState(taskId)).toMatchObject({ status: 'new' })
    expect(await historyCount(taskId)).toBe(1)
  })

  it('cannot clear must_change_password directly → 42501', async () => {
    const { error } = await freshExecutor.client
      .from('profiles')
      .update({ must_change_password: false })
      .eq('id', freshExecutor.id)
    expect(error).toMatchObject({ code: '42501' })

    const { data } = await freshExecutor.client
      .from('profiles')
      .select('must_change_password')
      .eq('id', freshExecutor.id)
      .single()
    expect(data).toEqual({ must_change_password: true })
  })
})

describe('profiles', () => {
  it('executor cannot change his own role → 42501', async () => {
    const { error } = await e1.client.from('profiles').update({ role: 'manager' }).eq('id', e1.id)
    expect(error).toMatchObject({ code: '42501' })

    const { data } = await e1.client.from('profiles').select('role').eq('id', e1.id).single()
    expect(data).toEqual({ role: 'executor' })
  })

  it('E2 cannot read E1 profile', async () => {
    const { data, error } = await e2.client.from('profiles').select('id').eq('id', e1.id)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})

describe('anon (publishable key, no session) reads nothing', () => {
  it.each(['profiles', 'objects', 'tasks', 'task_status_history', 'task_transitions'] as const)(
    '%s → 42501',
    async (table) => {
      const { data, error, status } = await anonClient().from(table).select('*').limit(1)
      expect(error).toMatchObject({ code: '42501' })
      expect(status).toBe(401)
      expect(data).toBeNull()
    },
  )

  it('cannot call change_task_status → 42501', async () => {
    const { error } = await anonClient().rpc('change_task_status', {
      p_task_id: crypto.randomUUID(),
      p_to_status: 'in_progress',
    })
    expect(error).toMatchObject({ code: '42501' })
  })
})
