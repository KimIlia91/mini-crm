import { beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/shared/api/database.types'

import { createTestUser, type TestUser } from '../setup/supabase'

// Task workflow against the real local Supabase. Every test creates its own task (and uses
// users created once per file); assertions only look at rows created here (no global counts).

type Status = Database['public']['Enums']['task_status']

let m1: TestUser
let m2: TestUser
let e1: TestUser
let e2: TestUser
let objectId: string

beforeAll(async () => {
  ;[m1, m2, e1, e2] = await Promise.all([
    createTestUser('manager', 'wf-m1'),
    createTestUser('manager', 'wf-m2'),
    createTestUser('executor', 'wf-e1'),
    createTestUser('executor', 'wf-e2'),
  ])
  const { data, error } = await m1.client
    .from('objects')
    .insert({ name: `wf-object-${crypto.randomUUID()}`, address: 'wf address' })
    .select('id')
    .single()
  if (error) throw error
  objectId = data.id
})

async function createTask(assignee: TestUser, title = 'wf-task'): Promise<string> {
  const { data, error } = await m1.client
    .from('tasks')
    .insert({ object_id: objectId, title, assignee_id: assignee.id })
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

async function history(user: TestUser, taskId: string) {
  const { data, error } = await user.client
    .from('task_status_history')
    .select('id, from_status, to_status, changed_by, comment')
    .eq('task_id', taskId)
    .order('id', { ascending: true })
  if (error) throw error
  return data
}

async function status(taskId: string): Promise<Status> {
  const { data, error } = await m1.client.from('tasks').select('status').eq('id', taskId).single()
  if (error) throw error
  return data.status
}

async function put(taskId: string, steps: [TestUser, Status, string?][]) {
  for (const [user, to, comment] of steps) {
    const { error } = await change(user, taskId, to, comment)
    if (error) throw error
  }
}

describe('full path', () => {
  it('new -> in_progress -> in_review -> rework -> in_progress -> in_review -> accepted writes 7 history rows', async () => {
    const taskId = await createTask(e1)
    await put(taskId, [
      [e1, 'in_progress'],
      [e1, 'in_review'],
      [m1, 'rework', 'please fix'],
      [e1, 'in_progress'],
      [e1, 'in_review'],
      [m1, 'accepted'],
    ])

    const expected = [
      [null, 'new', m1.id, null],
      ['new', 'in_progress', e1.id, null],
      ['in_progress', 'in_review', e1.id, null],
      ['in_review', 'rework', m1.id, 'please fix'],
      ['rework', 'in_progress', e1.id, null],
      ['in_progress', 'in_review', e1.id, null],
      ['in_review', 'accepted', m1.id, null],
    ]
    for (const viewer of [m1, e1]) {
      const rows = await history(viewer, taskId)
      expect(rows.map((r) => [r.from_status, r.to_status, r.changed_by, r.comment])).toEqual(
        expected,
      )
    }
    expect(await status(taskId)).toBe('accepted')
  })

  it('trims the rework comment before storing it', async () => {
    const taskId = await createTask(e1)
    await put(taskId, [
      [e1, 'in_progress'],
      [e1, 'in_review'],
      [m1, 'rework', '  padded  '],
    ])
    const rows = await history(m1, taskId)
    expect(rows.at(-1)?.comment).toBe('padded')
  })
})

describe('forbidden transitions (state and history unchanged)', () => {
  async function expectDenied(
    user: TestUser,
    taskId: string,
    to: Status,
    message: string,
    comment?: string,
  ) {
    const before = { status: await status(taskId), history: await history(m1, taskId) }
    const { error } = await change(user, taskId, to, comment)
    expect(error?.code).toBe('P0001')
    expect(error?.message).toBe(message)
    expect(await status(taskId)).toBe(before.status)
    expect(await history(m1, taskId)).toEqual(before.history)
  }

  it('executor cannot accept', async () => {
    const taskId = await createTask(e1)
    await put(taskId, [
      [e1, 'in_progress'],
      [e1, 'in_review'],
    ])
    await expectDenied(e1, taskId, 'accepted', 'transition_not_allowed')
  })

  it('manager cannot take a task into work', async () => {
    const taskId = await createTask(e1)
    await expectDenied(m1, taskId, 'in_progress', 'transition_not_allowed')
  })

  it('cannot skip new -> in_review', async () => {
    const taskId = await createTask(e1)
    await expectDenied(e1, taskId, 'in_review', 'transition_not_allowed')
  })

  it('cannot move away from accepted', async () => {
    const taskId = await createTask(e1)
    await put(taskId, [
      [e1, 'in_progress'],
      [e1, 'in_review'],
      [m1, 'accepted'],
    ])
    await expectDenied(m1, taskId, 'rework', 'transition_not_allowed', 'late')
    await expectDenied(e1, taskId, 'in_progress', 'transition_not_allowed')
    await expectDenied(m1, taskId, 'new', 'transition_not_allowed')
  })

  it('cannot repeat the same status', async () => {
    const taskId = await createTask(e1)
    await expectDenied(e1, taskId, 'new', 'transition_not_allowed')
  })

  it.each([
    ['no comment', undefined],
    ['empty comment', ''],
    ['spaces-only comment', '     '],
  ])('rework with %s is rejected', async (_name, comment) => {
    const taskId = await createTask(e1)
    await put(taskId, [
      [e1, 'in_progress'],
      [e1, 'in_review'],
    ])
    await expectDenied(m1, taskId, 'rework', 'comment_required', comment)
    expect(await status(taskId)).toBe('in_review')
  })
})

// Blank = ASCII whitespace (space, tab, LF, CR, FF, VT) — the same rule as the DB checks.
it('rework with a tab/newline-only comment is rejected (comment_required)', async () => {
  const taskId = await createTask(e1)
  await put(taskId, [
    [e1, 'in_progress'],
    [e1, 'in_review'],
  ])
  const { error } = await change(m1, taskId, 'rework', '\n\t ')
  expect(error?.message).toBe('comment_required')
})

describe('races', () => {
  it('two parallel in_progress by the same executor: one success, one transition_not_allowed', async () => {
    const taskId = await createTask(e1)
    const results = await Promise.all([
      change(e1, taskId, 'in_progress'),
      change(e1, taskId, 'in_progress'),
    ])
    const errors = results.map((r) => r.error).filter((e) => e !== null)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ code: 'P0001', message: 'transition_not_allowed' })

    expect(await status(taskId)).toBe('in_progress')
    const rows = await history(m1, taskId)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({ from_status: 'new', to_status: 'in_progress' })
  })

  it('accept vs rework by two managers: exactly one wins and the state matches the winner', async () => {
    const taskId = await createTask(e1)
    await put(taskId, [
      [e1, 'in_progress'],
      [e1, 'in_review'],
    ])
    const [accept, rework] = await Promise.all([
      change(m1, taskId, 'accepted'),
      change(m2, taskId, 'rework', 'race comment'),
    ])
    expect([accept.error === null, rework.error === null].filter(Boolean)).toHaveLength(1)
    const loser = accept.error ?? rework.error
    expect(loser).toMatchObject({ code: 'P0001', message: 'transition_not_allowed' })

    const winner = accept.error === null ? 'accepted' : 'rework'
    expect(await status(taskId)).toBe(winner)
    const rows = await history(m1, taskId)
    expect(rows).toHaveLength(4)
    expect(rows[3]).toMatchObject({
      from_status: 'in_review',
      to_status: winner,
      changed_by: winner === 'accepted' ? m1.id : m2.id,
    })
  })
})

describe('reassignment and deletion', () => {
  it('E1 loses access after reassignment, E2 continues from the current status', async () => {
    const taskId = await createTask(e1)
    await put(taskId, [[e1, 'in_progress']])

    const { error: reassignError } = await m1.client
      .from('tasks')
      .update({ assignee_id: e2.id })
      .eq('id', taskId)
    expect(reassignError).toBeNull()

    const { data: visible, error: selectError } = await e1.client
      .from('tasks')
      .select('id')
      .eq('id', taskId)
    expect(selectError).toBeNull()
    expect(visible).toEqual([])
    expect(await history(e1, taskId)).toEqual([])

    const denied = await change(e1, taskId, 'in_review')
    expect(denied.error).toMatchObject({ code: 'P0001', message: 'task_not_found' })

    expect(await change(e2, taskId, 'in_review')).toMatchObject({ error: null })
    expect(await status(taskId)).toBe('in_review')
    const rows = await history(e2, taskId)
    expect(rows.at(-1)).toMatchObject({
      from_status: 'in_progress',
      to_status: 'in_review',
      changed_by: e2.id,
    })
    expect(rows).toHaveLength(3)
  })

  it('assigning a task to a manager is rejected', async () => {
    const taskId = await createTask(e1)
    const { error } = await m1.client.from('tasks').update({ assignee_id: m2.id }).eq('id', taskId)
    expect(error?.message).toBe('assignee_not_executor')
  })

  it('an object with an active task cannot be deleted (object_has_tasks); after deleting its tasks it can', async () => {
    const { data: object, error: objectError } = await m1.client
      .from('objects')
      .insert({ name: `wf-del-${crypto.randomUUID()}`, address: 'addr' })
      .select('id')
      .single()
    if (objectError) throw objectError
    const { data: task, error: taskError } = await m1.client
      .from('tasks')
      .insert({ object_id: object.id, title: 'to delete', assignee_id: e1.id })
      .select('id')
      .single()
    if (taskError) throw taskError
    await put(task.id, [[e1, 'in_progress']])
    expect(await history(m1, task.id)).toHaveLength(2)

    const blocked = await m1.client.rpc('delete_object', { p_object_id: object.id })
    expect(blocked.error).toMatchObject({ code: 'P0001', message: 'object_has_tasks' })
    const { data: stillThere } = await m1.client.from('objects').select('id').eq('id', object.id)
    expect(stillThere).toHaveLength(1)

    const removeTask = await m1.client.rpc('delete_task', { p_task_id: task.id })
    expect(removeTask.error).toBeNull()
    expect(await history(m1, task.id)).toEqual([])
    const { data: gone } = await m1.client.from('tasks').select('id').eq('id', task.id)
    expect(gone).toEqual([])

    // repeat delete, status change and edit of a deleted task
    const repeatTask = await m1.client.rpc('delete_task', { p_task_id: task.id })
    expect(repeatTask.error).toMatchObject({ code: 'P0001', message: 'task_not_found' })
    const changed = await change(e1, task.id, 'in_review')
    expect(changed.error).toMatchObject({ code: 'P0001', message: 'task_not_found' })
    const edited = await m1.client
      .from('tasks')
      .update({ title: 'after delete' })
      .eq('id', task.id)
      .select('id')
      .single()
    expect(edited.error?.code).toBe('PGRST116')

    const removeObject = await m1.client.rpc('delete_object', { p_object_id: object.id })
    expect(removeObject.error).toBeNull()
    const { data: objectGone } = await m1.client.from('objects').select('id').eq('id', object.id)
    expect(objectGone).toEqual([])

    const repeatObject = await m1.client.rpc('delete_object', { p_object_id: object.id })
    expect(repeatObject.error).toMatchObject({ code: 'P0001', message: 'object_not_found' })

    const inDeleted = await m1.client
      .from('tasks')
      .insert({ object_id: object.id, title: 'orphan', assignee_id: e1.id })
    expect(inDeleted.error).toMatchObject({ message: 'object_not_found' })
  })

  it('direct client DELETE of a task is forbidden with 42501', async () => {
    const taskId = await createTask(e1)
    const { error } = await m1.client.from('tasks').delete().eq('id', taskId)
    expect(error?.code).toBe('42501')
    expect(await status(taskId)).toBe('new')
  })
})

describe('boundaries', () => {
  it('task title: 200 characters ok, 201 rejected with 23514', async () => {
    const ok = await m1.client
      .from('tasks')
      .insert({ object_id: objectId, title: 't'.repeat(200), assignee_id: e1.id })
      .select('id')
      .single()
    expect(ok.error).toBeNull()

    const tooLong = await m1.client
      .from('tasks')
      .insert({ object_id: objectId, title: 't'.repeat(201), assignee_id: e1.id })
    expect(tooLong.error?.code).toBe('23514')

    const blank = await m1.client
      .from('tasks')
      .insert({ object_id: objectId, title: '   ', assignee_id: e1.id })
    expect(blank.error?.code).toBe('23514')
  })

  it('rework comment: 1000 characters ok, 1001 rejected with 23514 and nothing changes', async () => {
    const tooLongTask = await createTask(e1)
    await put(tooLongTask, [
      [e1, 'in_progress'],
      [e1, 'in_review'],
    ])
    const rejected = await change(m1, tooLongTask, 'rework', 'c'.repeat(1001))
    expect(rejected.error?.code).toBe('23514')
    expect(await status(tooLongTask)).toBe('in_review')
    expect(await history(m1, tooLongTask)).toHaveLength(3)

    const okTask = await createTask(e1)
    await put(okTask, [
      [e1, 'in_progress'],
      [e1, 'in_review'],
    ])
    const accepted = await change(m1, okTask, 'rework', 'c'.repeat(1000))
    expect(accepted.error).toBeNull()
    expect(await status(okTask)).toBe('rework')
    expect((await history(m1, okTask)).at(-1)?.comment).toHaveLength(1000)
  })

  it('manager editing the title of an accepted task updates 0 rows (PGRST116)', async () => {
    const taskId = await createTask(e1, 'before')
    await put(taskId, [
      [e1, 'in_progress'],
      [e1, 'in_review'],
      [m1, 'accepted'],
    ])
    const { data, error } = await m1.client
      .from('tasks')
      .update({ title: 'after' })
      .eq('id', taskId)
      .select()
      .single()
    expect(data).toBeNull()
    expect(error?.code).toBe('PGRST116')

    const { data: row } = await m1.client.from('tasks').select('title').eq('id', taskId).single()
    expect(row?.title).toBe('before')
  })
})
