import { beforeAll, describe, expect, it } from 'vitest'

import { anonClient, createTestUser, type TestUser } from '../../setup/supabase'

// Soft delete through direct Data API requests (REST/RPC), bypassing the UI. Only the
// delete_task / delete_object RPCs may delete, only for an activated manager; deleted rows and
// the history of deleted tasks are invisible to every client and cannot be restored via the API.
// Users and rows are unique per run; assertions only touch rows created here.

let m1: TestUser
let m2: TestUser
let e1: TestUser
let e2: TestUser
let freshManager: TestUser

const notFoundTask = { code: 'P0001', message: 'task_not_found' }
const notFoundObject = { code: 'P0001', message: 'object_not_found' }

async function createObject(): Promise<string> {
  const { data, error } = await m1.client
    .from('objects')
    .insert({ name: `sd-object-${crypto.randomUUID()}`, address: 'sd address' })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

async function createTask(objectId: string, assignee: TestUser = e1): Promise<string> {
  const { data, error } = await m1.client
    .from('tasks')
    .insert({ object_id: objectId, title: 'sd-task', assignee_id: assignee.id })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

async function visibleTaskIds(user: TestUser, taskId: string): Promise<string[]> {
  const { data, error } = await user.client.from('tasks').select('id').eq('id', taskId)
  if (error) throw error
  return data.map((row) => row.id)
}

async function visibleObjectIds(user: TestUser, objectId: string): Promise<string[]> {
  const { data, error } = await user.client.from('objects').select('id').eq('id', objectId)
  if (error) throw error
  return data.map((row) => row.id)
}

async function visibleHistoryCount(user: TestUser, taskId: string): Promise<number> {
  const { count, error } = await user.client
    .from('task_status_history')
    .select('id', { count: 'exact', head: true })
    .eq('task_id', taskId)
  if (error) throw error
  return count ?? -1
}

beforeAll(async () => {
  ;[m1, m2, e1, e2, freshManager] = await Promise.all([
    createTestUser('manager', 'sd-m1'),
    createTestUser('manager', 'sd-m2'),
    createTestUser('executor', 'sd-e1'),
    createTestUser('executor', 'sd-e2'),
    createTestUser('manager', 'sd-fresh-m', { changePassword: false }),
  ])
})

describe('only an activated manager can soft-delete', () => {
  let objectId: string
  let taskId: string
  let emptyObjectId: string
  beforeAll(async () => {
    ;[objectId, emptyObjectId] = await Promise.all([createObject(), createObject()])
    taskId = await createTask(objectId)
  })

  it.each([
    ['assignee executor', () => e1],
    ['other executor', () => e2],
    ['manager without changed password', () => freshManager],
  ])('%s: delete_task → task_not_found, delete_object → object_not_found', async (_, who) => {
    const user = who()
    const task = await user.client.rpc('delete_task', { p_task_id: taskId })
    expect(task.error).toMatchObject(notFoundTask)
    const object = await user.client.rpc('delete_object', { p_object_id: emptyObjectId })
    expect(object.error).toMatchObject(notFoundObject)

    expect(await visibleTaskIds(m1, taskId)).toEqual([taskId])
    expect(await visibleObjectIds(m1, emptyObjectId)).toEqual([emptyObjectId])
  })

  it('assignee cannot delete the object he sees (object_not_found)', async () => {
    expect(await visibleObjectIds(e1, objectId)).toEqual([objectId])
    const { error } = await e1.client.rpc('delete_object', { p_object_id: objectId })
    expect(error).toMatchObject(notFoundObject)
  })

  it('anon cannot call the delete RPCs → 42501', async () => {
    const task = await anonClient().rpc('delete_task', { p_task_id: taskId })
    expect(task.error).toMatchObject({ code: '42501' })
    expect(task.status).toBe(401)
    const object = await anonClient().rpc('delete_object', { p_object_id: emptyObjectId })
    expect(object.error).toMatchObject({ code: '42501' })
    expect(object.status).toBe(401)
  })

  it('client DELETE on tasks/objects → 42501 even for a manager', async () => {
    const task = await m1.client.from('tasks').delete().eq('id', taskId)
    expect(task.error).toMatchObject({ code: '42501' })
    expect(task.status).toBe(403)
    const object = await m1.client.from('objects').delete().eq('id', emptyObjectId)
    expect(object.error).toMatchObject({ code: '42501' })
    expect(object.status).toBe(403)
    expect(await visibleTaskIds(m1, taskId)).toEqual([taskId])
  })
})

describe('deleted_at / deleted_by are not client-writable', () => {
  let objectId: string
  let taskId: string
  beforeAll(async () => {
    objectId = await createObject()
    taskId = await createTask(objectId)
  })

  it('soft-delete by PATCH (deleted_at / deleted_by) → 42501', async () => {
    const task = await m1.client
      .from('tasks')
      .update({ deleted_at: new Date().toISOString(), deleted_by: m2.id })
      .eq('id', taskId)
    expect(task.error).toMatchObject({ code: '42501' })
    const spoof = await m1.client.from('tasks').update({ deleted_by: m2.id }).eq('id', taskId)
    expect(spoof.error).toMatchObject({ code: '42501' })
    const object = await m1.client
      .from('objects')
      .update({ deleted_at: new Date().toISOString(), deleted_by: m2.id })
      .eq('id', objectId)
    expect(object.error).toMatchObject({ code: '42501' })
    expect(await visibleTaskIds(m1, taskId)).toEqual([taskId])
  })

  it('insert with deleted_at / deleted_by → 42501', async () => {
    const task = await m1.client.from('tasks').insert({
      object_id: objectId,
      title: 'sd-pre-deleted',
      assignee_id: e1.id,
      deleted_at: new Date().toISOString(),
      deleted_by: m1.id,
    })
    expect(task.error).toMatchObject({ code: '42501' })
    const object = await m1.client.from('objects').insert({
      name: 'sd-pre-deleted',
      address: 'x',
      deleted_at: new Date().toISOString(),
      deleted_by: m1.id,
    })
    expect(object.error).toMatchObject({ code: '42501' })
  })
})

describe('a deleted task is gone for every client', () => {
  let objectId: string
  let taskId: string
  beforeAll(async () => {
    objectId = await createObject()
    taskId = await createTask(objectId)
    const take = await e1.client.rpc('change_task_status', {
      p_task_id: taskId,
      p_to_status: 'in_progress',
    })
    if (take.error) throw take.error
    const { error } = await m1.client.rpc('delete_task', { p_task_id: taskId })
    if (error) throw error
  })

  it('select by id is empty for the deleting manager, another manager and the assignee', async () => {
    expect(await visibleTaskIds(m1, taskId)).toEqual([])
    expect(await visibleTaskIds(m2, taskId)).toEqual([])
    expect(await visibleTaskIds(e1, taskId)).toEqual([])
  })

  it('its history is empty for the manager and the assignee', async () => {
    expect(await visibleHistoryCount(m1, taskId)).toBe(0)
    expect(await visibleHistoryCount(e1, taskId)).toBe(0)
  })

  it('the assignee no longer sees the object (his only task there is deleted)', async () => {
    expect(await visibleObjectIds(e1, objectId)).toEqual([])
    expect(await visibleObjectIds(m1, objectId)).toEqual([objectId])
  })

  it('restore by PATCH deleted_at = null → 42501, still invisible', async () => {
    const { error } = await m1.client
      .from('tasks')
      .update({ deleted_at: null, deleted_by: null })
      .eq('id', taskId)
    expect(error).toMatchObject({ code: '42501' })
    expect(await visibleTaskIds(m1, taskId)).toEqual([])
  })

  it('edit affects 0 rows', async () => {
    const { data, error } = await m1.client
      .from('tasks')
      .update({ title: 'sd-edit-deleted' })
      .eq('id', taskId)
      .select('id')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('status change → task_not_found for the assignee and a manager', async () => {
    const executor = await e1.client.rpc('change_task_status', {
      p_task_id: taskId,
      p_to_status: 'in_review',
    })
    expect(executor.error).toMatchObject(notFoundTask)
    const manager = await m1.client.rpc('change_task_status', {
      p_task_id: taskId,
      p_to_status: 'accepted',
    })
    expect(manager.error).toMatchObject(notFoundTask)
  })

  it('repeated delete_task → task_not_found (same as a missing id)', async () => {
    const repeat = await m2.client.rpc('delete_task', { p_task_id: taskId })
    expect(repeat.error).toMatchObject(notFoundTask)
    const missing = await m2.client.rpc('delete_task', { p_task_id: crypto.randomUUID() })
    expect(missing.error).toMatchObject(notFoundTask)
  })
})

describe('object deletion rules', () => {
  it('object with an active task → object_has_tasks; after the task is deleted → ok', async () => {
    const objectId = await createObject()
    const taskId = await createTask(objectId)

    const blocked = await m1.client.rpc('delete_object', { p_object_id: objectId })
    expect(blocked.error).toMatchObject({ code: 'P0001', message: 'object_has_tasks' })
    expect(await visibleObjectIds(m1, objectId)).toEqual([objectId])

    expect((await m1.client.rpc('delete_task', { p_task_id: taskId })).error).toBeNull()
    expect((await m1.client.rpc('delete_object', { p_object_id: objectId })).error).toBeNull()

    expect(await visibleObjectIds(m1, objectId)).toEqual([])
    expect(await visibleObjectIds(m2, objectId)).toEqual([])
  })

  it('deleted object: no restore, no rename, no new tasks, repeat → object_not_found', async () => {
    const objectId = await createObject()
    expect((await m1.client.rpc('delete_object', { p_object_id: objectId })).error).toBeNull()

    const restore = await m1.client
      .from('objects')
      .update({ deleted_at: null, deleted_by: null })
      .eq('id', objectId)
    expect(restore.error).toMatchObject({ code: '42501' })

    const rename = await m1.client
      .from('objects')
      .update({ name: 'sd-renamed' })
      .eq('id', objectId)
      .select('id')
    expect(rename.error).toBeNull()
    expect(rename.data).toEqual([])

    const task = await m1.client
      .from('tasks')
      .insert({ object_id: objectId, title: 'sd-in-deleted', assignee_id: e1.id })
      .select('id')
    expect(task.error).toMatchObject(notFoundObject)
    expect(task.data).toBeNull()

    const repeat = await m2.client.rpc('delete_object', { p_object_id: objectId })
    expect(repeat.error).toMatchObject(notFoundObject)
    const missing = await m2.client.rpc('delete_object', { p_object_id: crypto.randomUUID() })
    expect(missing.error).toMatchObject(notFoundObject)
  })
})

describe('races', () => {
  const N = 6

  it(`${N} parallel delete_task on one task → exactly one success`, async () => {
    const taskId = await createTask(await createObject())
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        (i % 2 ? m2 : m1).client.rpc('delete_task', { p_task_id: taskId }),
      ),
    )
    const ok = results.filter((r) => r.error === null)
    expect(ok).toHaveLength(1)
    for (const r of results.filter((x) => x.error !== null)) {
      expect(r.error).toMatchObject(notFoundTask)
    }
    expect(await visibleTaskIds(m1, taskId)).toEqual([])
  })

  it(`${N} parallel delete_object on one object → exactly one success`, async () => {
    const objectId = await createObject()
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        (i % 2 ? m2 : m1).client.rpc('delete_object', { p_object_id: objectId }),
      ),
    )
    expect(results.filter((r) => r.error === null)).toHaveLength(1)
    for (const r of results.filter((x) => x.error !== null)) {
      expect(r.error).toMatchObject(notFoundObject)
    }
    expect(await visibleObjectIds(m1, objectId)).toEqual([])
  })

  it('delete_task vs change_task_status: delete wins, status change is either done first or task_not_found', async () => {
    const objectId = await createObject()
    const tasks = await Promise.all(Array.from({ length: N }, () => createTask(objectId)))

    const outcomes = await Promise.all(
      tasks.map(async (taskId) => {
        const [del, change] = await Promise.all([
          m1.client.rpc('delete_task', { p_task_id: taskId }),
          e1.client.rpc('change_task_status', { p_task_id: taskId, p_to_status: 'in_progress' }),
        ])
        return { taskId, del, change }
      }),
    )

    for (const { taskId, del, change } of outcomes) {
      expect(del.error).toBeNull()
      if (change.error !== null) expect(change.error).toMatchObject(notFoundTask)
      expect(await visibleTaskIds(m1, taskId)).toEqual([])
      expect(await visibleTaskIds(e1, taskId)).toEqual([])
      // After the delete nothing can move the task any further.
      const after = await e1.client.rpc('change_task_status', {
        p_task_id: taskId,
        p_to_status: 'in_review',
      })
      expect(after.error).toMatchObject(notFoundTask)
    }
  })

  it('delete_object vs task insert: never both succeed (no active task in a deleted object)', async () => {
    const objects = await Promise.all(Array.from({ length: N }, () => createObject()))

    const outcomes = await Promise.all(
      objects.map(async (objectId) => {
        const [del, insert] = await Promise.all([
          m1.client.rpc('delete_object', { p_object_id: objectId }),
          m2.client
            .from('tasks')
            .insert({ object_id: objectId, title: 'sd-race', assignee_id: e1.id })
            .select('id')
            .single(),
        ])
        return { objectId, del, insert }
      }),
    )

    for (const { objectId, del, insert } of outcomes) {
      if (del.error === null) {
        // Delete first: the insert saw the deleted object.
        expect(insert.error).toMatchObject(notFoundObject)
        expect(await visibleObjectIds(m1, objectId)).toEqual([])
      } else {
        // Insert first: the delete saw the active task.
        expect(del.error).toMatchObject({ code: 'P0001', message: 'object_has_tasks' })
        expect(insert.error).toBeNull()
        expect(await visibleObjectIds(m1, objectId)).toEqual([objectId])
        expect(await visibleTaskIds(m1, insert.data?.id ?? '')).toHaveLength(1)
      }
    }
  })
})
