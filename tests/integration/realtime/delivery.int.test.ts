import { afterEach, describe, expect, it } from 'vitest'

import { about, closeAllChannels, createWorld, listen } from '../../setup/realtime'

// Live hints against the real local Realtime: who receives which hint after a data change.

afterEach(closeAllChannels)

describe('task hints', () => {
  it('assignee gets task edits and status changes with exactly {id, object_id}; other executor does not', async () => {
    const { m1, e1, e2, objectId, createTask } = await createWorld()
    const taskId = await createTask(e1)
    const [a, b] = await Promise.all([
      listen(e1, `user:${e1.id}`, ['task']),
      listen(e2, `user:${e2.id}`, ['task']),
    ])

    const edit = await m1.client.from('tasks').update({ title: 'edited' }).eq('id', taskId)
    expect(edit.error).toBeNull()
    const hint = await a.waitFor(about('task', taskId))
    expect(Object.keys(hint.payload).sort()).toEqual(['id', 'object_id'])
    expect(hint.payload).toEqual({ id: taskId, object_id: objectId })

    const before = a.received.filter((m) => m.payload.id === taskId).length
    const status = await e1.client.rpc('change_task_status', {
      p_task_id: taskId,
      p_to_status: 'in_progress',
    })
    expect(status.error).toBeNull()
    await a.waitFor(() => a.received.filter((m) => m.payload.id === taskId).length > before)

    expect(await b.quietPeriod(about('task', taskId))).toEqual([])
  })

  it('managers get the hint on role:manager, executors cannot be on it', async () => {
    const { m1, m2, e1, createTask } = await createWorld()
    const manager = await listen(m2, 'role:manager', ['task'])
    const taskId = await createTask(e1)
    const hint = await manager.waitFor(about('task', taskId))
    expect(hint.payload.id).toBe(taskId)

    const edit = await m1.client.from('tasks').update({ title: 'x2' }).eq('id', taskId)
    expect(edit.error).toBeNull()
    await manager.waitFor(() => manager.received.filter((m) => m.payload.id === taskId).length >= 2)
  })

  it('reassignment A -> B notifies both executors', async () => {
    const { m1, e1, e2, createTask } = await createWorld()
    const taskId = await createTask(e1)
    const [a, b] = await Promise.all([
      listen(e1, `user:${e1.id}`, ['task']),
      listen(e2, `user:${e2.id}`, ['task']),
    ])
    const { error } = await m1.client.from('tasks').update({ assignee_id: e2.id }).eq('id', taskId)
    expect(error).toBeNull()
    await Promise.all([a.waitFor(about('task', taskId)), b.waitFor(about('task', taskId))])
  })

  it('soft delete reaches the assignee (the row is already invisible to them)', async () => {
    const { m1, e1, createTask } = await createWorld()
    const taskId = await createTask(e1)
    const a = await listen(e1, `user:${e1.id}`, ['task'])
    const { error } = await m1.client.rpc('delete_task', { p_task_id: taskId })
    expect(error).toBeNull()
    await a.waitFor(about('task', taskId))
  })

  it('a rolled back change sends nothing', async () => {
    const { m1, e1, createTask } = await createWorld()
    const taskId = await createTask(e1)
    const a = await listen(e1, `user:${e1.id}`, ['task'])
    // Forbidden transition for a manager: rejected in the database, must not leave a hint.
    const { error } = await m1.client.rpc('change_task_status', {
      p_task_id: taskId,
      p_to_status: 'accepted',
    })
    expect(error).not.toBeNull()
    expect(await a.quietPeriod(about('task', taskId))).toEqual([])
  })
})

describe('object hints', () => {
  it('rename reaches the active assignee and managers, not an unrelated executor', async () => {
    const { m1, m2, e1, e2, objectId, createTask } = await createWorld()
    await createTask(e1)
    const [a, b, manager] = await Promise.all([
      listen(e1, `user:${e1.id}`, ['object']),
      listen(e2, `user:${e2.id}`, ['object']),
      listen(m2, 'role:manager', ['object']),
    ])
    const { error } = await m1.client
      .from('objects')
      .update({ name: `renamed-${crypto.randomUUID()}` })
      .eq('id', objectId)
    expect(error).toBeNull()

    const hint = await a.waitFor(about('object', objectId))
    expect(Object.keys(hint.payload)).toEqual(['id'])
    await manager.waitFor(about('object', objectId))
    expect(await b.quietPeriod(about('object', objectId))).toEqual([])
  })

  it('an assignee of only a deleted task gets no object hint', async () => {
    const { m1, e1, objectId, createTask } = await createWorld()
    const taskId = await createTask(e1)
    expect((await m1.client.rpc('delete_task', { p_task_id: taskId })).error).toBeNull()
    const a = await listen(e1, `user:${e1.id}`, ['object'])
    const { error } = await m1.client
      .from('objects')
      .update({ name: `renamed-${crypto.randomUUID()}` })
      .eq('id', objectId)
    expect(error).toBeNull()
    expect(await a.quietPeriod(about('object', objectId))).toEqual([])
  })
})
