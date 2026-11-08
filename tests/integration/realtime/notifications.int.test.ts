import { afterEach, describe, expect, it } from 'vitest'

import type { Database } from '@/shared/api/database.types'

import {
  closeAllChannels,
  createWorld,
  listen,
  notificationWith,
  type World,
} from '../../setup/realtime'
import { createTestUser, type TestUser } from '../../setup/supabase'

// Notifications end to end against the real local Supabase + Realtime: rows written by triggers,
// hints to user:<uid>, read RPCs and races between concurrent transactions.

type Status = Database['public']['Enums']['task_status']

afterEach(closeAllChannels)

function change(user: TestUser, taskId: string, to: Status, comment?: string) {
  return user.client.rpc('change_task_status', {
    p_task_id: taskId,
    p_to_status: to,
    p_comment: comment,
  })
}

async function mine(user: TestUser, taskId: string) {
  const { data, error } = await user.client
    .from('notifications')
    .select('id, kind, comment, actor_id, read_at, resolved_at, resolved_by, resolution')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw error
  return data
}

async function kinds(user: TestUser, taskId: string) {
  return (await mine(user, taskId)).map((n) => n.kind)
}

async function reviewRow(user: TestUser, taskId: string) {
  const row = (await mine(user, taskId)).find((n) => n.kind === 'task_in_review')
  if (!row) throw new Error('no task_in_review row')
  return row
}

async function unread(user: TestUser, taskId?: string): Promise<number> {
  let query = user.client
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)
  if (taskId) query = query.eq('task_id', taskId)
  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

/** Task assigned to e1 and sent to review by e1; returns its id. */
async function taskInReview(w: World): Promise<string> {
  const taskId = await w.createTask(w.e1)
  expect((await change(w.e1, taskId, 'in_progress')).error).toBeNull()
  expect((await change(w.e1, taskId, 'in_review')).error).toBeNull()
  return taskId
}

describe('delivery of notifications', () => {
  it('a new task notifies the assignee (op created); the row is readable by them only', async () => {
    const w = await createWorld()
    const hints = await listen(w.e1, `user:${w.e1.id}`, ['notification'])
    const other = await listen(w.e2, `user:${w.e2.id}`, ['notification'])
    const taskId = await w.createTask(w.e1, 'brand new')

    const hint = await hints.waitFor(notificationWith('created'))
    expect(
      Object.keys(hint.payload)
        .filter((k) => k !== 'id')
        .sort(),
    ).toEqual(['ids', 'op'])
    const ids = hint.payload.ids as string[]
    const { data, error } = await w.e1.client
      .from('notifications')
      .select('id, kind, task_id, actor_id, title_snapshot, read_at')
      .in('id', ids)
    expect(error).toBeNull()
    expect(data).toEqual([
      {
        id: ids[0],
        kind: 'task_assigned',
        task_id: taskId,
        actor_id: w.m1.id,
        title_snapshot: 'brand new',
        read_at: null,
      },
    ])

    const foreign = await w.e2.client.from('notifications').select('id').in('id', ids)
    expect(foreign.data).toEqual([])
    expect(await other.quietPeriod(notificationWith('created'))).toEqual([])
  })

  it('sending to review notifies managers through role:manager hints without ids, not per manager', async () => {
    const w = await createWorld()
    // Extra managers make a per-manager fan-out visible: it would send >= EXTRA user hints.
    const EXTRA = 20
    await Promise.all(Array.from({ length: EXTRA }, () => createTestUser('manager', 'rt-extra')))
    const [group, own] = await Promise.all([
      listen(w.m2, 'role:manager', ['notification']),
      listen(w.m2, `user:${w.m2.id}`, ['notification']),
    ])
    const taskId = await w.createTask(w.e1)
    expect((await change(w.e1, taskId, 'in_progress')).error).toBeNull()
    expect((await change(w.e1, taskId, 'in_review')).error).toBeNull()

    await group.waitFor(notificationWith('created'))
    const hints = await group.quietPeriod(notificationWith('created'))
    // Other suites may emit manager events too, but never one message per manager.
    expect(hints.length).toBeGreaterThanOrEqual(1)
    expect(hints.length).toBeLessThan(EXTRA)
    for (const hint of hints) {
      expect(Object.keys(hint.payload).filter((k) => k !== 'id')).toEqual(['op'])
    }
    // Review rows are announced to the group topic only, never to the manager's own topic.
    expect(own.received).toEqual([])
    expect(await kinds(w.m2, taskId)).toEqual(['task_in_progress', 'task_in_review'])
    expect(await kinds(w.e1, taskId)).toEqual(['task_assigned'])
  })

  it('accept by M1: M2 gets op updated and its unread count drops; the executor gets task_accepted', async () => {
    const w = await createWorld()
    const taskId = await taskInReview(w)
    const review = await reviewRow(w.m2, taskId)
    expect(review.read_at).toBeNull()

    const h2 = await listen(w.m2, 'role:manager', ['notification'])
    const he = await listen(w.e1, `user:${w.e1.id}`, ['notification'])
    const before = await unread(w.m2, taskId)

    expect((await change(w.m1, taskId, 'accepted')).error).toBeNull()

    const resolvedHint = await h2.waitFor(notificationWith('updated'))
    expect(resolvedHint.payload.ids).toBeUndefined()
    expect(await unread(w.m2, taskId)).toBe(before - 1)
    const resolved = await reviewRow(w.m2, taskId)
    expect(resolved).toMatchObject({ resolution: 'accepted', resolved_by: w.m1.id })
    expect(resolved.read_at).not.toBeNull()

    const hint = await he.waitFor(notificationWith('created'))
    const { data } = await w.e1.client
      .from('notifications')
      .select('kind, actor_id')
      .in('id', hint.payload.ids as string[])
    expect(data).toEqual([{ kind: 'task_accepted', actor_id: w.m1.id }])
  })

  it('rework carries the comment to the executor', async () => {
    const w = await createWorld()
    const taskId = await taskInReview(w)
    expect((await change(w.m1, taskId, 'rework', 'fix the door')).error).toBeNull()
    const rework = (await mine(w.e1, taskId)).find((n) => n.kind === 'task_rework')
    expect(rework).toMatchObject({ comment: 'fix the door', actor_id: w.m1.id })
    expect(await reviewRow(w.m2, taskId)).toMatchObject({ resolution: 'rework' })
  })

  it('nobody is notified about their own action', async () => {
    const w = await createWorld()

    const taskId = await taskInReview(w)
    expect((await change(w.m1, taskId, 'accepted')).error).toBeNull()
    // m1 saw the executor's actions only; e1 did not get rows for his own transitions.
    expect(await kinds(w.m1, taskId)).toEqual(['task_in_progress', 'task_in_review'])
    expect(await kinds(w.e1, taskId)).toEqual(['task_assigned', 'task_accepted'])
  })

  it('a rejected transition leaves no notifications', async () => {
    const w = await createWorld()
    const taskId = await w.createTask(w.e1)
    expect((await change(w.e1, taskId, 'accepted')).error).not.toBeNull()
    expect(await mine(w.m2, taskId)).toEqual([])
    expect(await kinds(w.e1, taskId)).toEqual(['task_assigned'])
  })

  it('soft delete resolves pending reviews as deleted and notifies the assignee', async () => {
    const w = await createWorld()
    const taskId = await taskInReview(w)
    expect((await w.m1.client.rpc('delete_task', { p_task_id: taskId })).error).toBeNull()
    expect(await reviewRow(w.m2, taskId)).toMatchObject({
      resolution: 'deleted',
      resolved_by: w.m1.id,
    })
    expect(await kinds(w.e1, taskId)).toContain('task_deleted')
  })
})

describe('mark read RPCs', () => {
  it('marks own rows, ignores foreign ids, is idempotent and sends op updated', async () => {
    const w = await createWorld()
    const taskId = await w.createTask(w.e1)
    const row = (await mine(w.e1, taskId))[0]
    if (!row) throw new Error('no notification')
    const h = await listen(w.e1, `user:${w.e1.id}`, ['notification'])

    expect((await w.e2.client.rpc('mark_notifications_read', { p_ids: [row.id] })).error).toBeNull()
    expect((await mine(w.e1, taskId))[0]?.read_at).toBeNull()

    expect((await w.e1.client.rpc('mark_notifications_read', { p_ids: [row.id] })).error).toBeNull()
    await h.waitFor(notificationWith('updated', row.id))
    const first = (await mine(w.e1, taskId))[0]?.read_at
    expect(first).not.toBeNull()
    expect((await w.e1.client.rpc('mark_notifications_read', { p_ids: [row.id] })).error).toBeNull()
    expect((await mine(w.e1, taskId))[0]?.read_at).toBe(first)
  })

  it('rejects null and more than 200 ids', async () => {
    const w = await createWorld()
    const tooMany = Array.from({ length: 201 }, () => crypto.randomUUID())
    const big = await w.e1.client.rpc('mark_notifications_read', { p_ids: tooMany })
    expect(big.error?.message).toContain('too_many_ids')
    const nil = await w.e1.client.rpc('mark_notifications_read', {
      p_ids: null as unknown as string[],
    })
    expect(nil.error?.message).toContain('ids_required')
  })
})

describe('races', () => {
  it('accept by M1 and return by M2 at once: one wins, one result notification, reviews resolved by the winner', async () => {
    const w = await createWorld()
    const taskId = await taskInReview(w)

    const [accept, rework] = await Promise.all([
      change(w.m1, taskId, 'accepted'),
      change(w.m2, taskId, 'rework', 'race comment'),
    ])
    expect([accept, rework].filter((r) => r.error)).toHaveLength(1)
    const m1Won = accept.error === null
    const winner = m1Won ? w.m1 : w.m2
    const kind = m1Won ? 'task_accepted' : 'task_rework'

    const results = (await kinds(w.e1, taskId)).filter((k) => k !== 'task_assigned')
    expect(results).toEqual([kind])

    for (const m of [w.m1, w.m2]) {
      const reviews = (await mine(m, taskId)).filter((n) => n.kind === 'task_in_review')
      expect(reviews).toHaveLength(1)
      expect(reviews[0]).toMatchObject({
        resolution: m1Won ? 'accepted' : 'rework',
        resolved_by: winner.id,
      })
      expect(reviews[0]?.read_at).not.toBeNull()
    }
  })

  it('executor sends to review twice at once: one set of in_review rows', async () => {
    const w = await createWorld()
    const taskId = await w.createTask(w.e1)
    expect((await change(w.e1, taskId, 'in_progress')).error).toBeNull()

    const results = await Promise.all([
      change(w.e1, taskId, 'in_review'),
      change(w.e1, taskId, 'in_review'),
    ])
    expect(results.filter((r) => r.error === null)).toHaveLength(1)
    for (const m of [w.m1, w.m2]) {
      const reviews = (await kinds(m, taskId)).filter((k) => k === 'task_in_review')
      expect(reviews).toHaveLength(1)
    }
  })

  it('mark_all in parallel: no errors, everything read', async () => {
    const w = await createWorld()
    await Promise.all([1, 2, 3].map(() => w.createTask(w.e1)))
    const results = await Promise.all([
      w.e1.client.rpc('mark_all_notifications_read'),
      w.e1.client.rpc('mark_all_notifications_read'),
      w.e1.client.rpc('mark_all_notifications_read'),
    ])
    for (const r of results) expect(r.error).toBeNull()
    expect(await unread(w.e1)).toBe(0)
  })

  it('mark read in parallel with the resolution: both succeed, resolved once, read_at stable', async () => {
    const w = await createWorld()
    const taskId = await taskInReview(w)
    const review = await reviewRow(w.m2, taskId)

    const [mark, accept] = await Promise.all([
      w.m2.client.rpc('mark_notifications_read', { p_ids: [review.id] }),
      change(w.m1, taskId, 'accepted'),
    ])
    expect(mark.error).toBeNull()
    expect(accept.error).toBeNull()

    const after = await reviewRow(w.m2, taskId)
    expect(after).toMatchObject({ resolution: 'accepted', resolved_by: w.m1.id })
    expect(after.read_at).not.toBeNull()
    expect((await w.m2.client.rpc('mark_all_notifications_read')).error).toBeNull()
    expect((await reviewRow(w.m2, taskId)).read_at).toBe(after.read_at)
  })

  it('an earlier read_at survives the resolution', async () => {
    const w = await createWorld()
    const taskId = await taskInReview(w)
    const review = await reviewRow(w.m2, taskId)
    expect(
      (await w.m2.client.rpc('mark_notifications_read', { p_ids: [review.id] })).error,
    ).toBeNull()
    const readAt = (await reviewRow(w.m2, taskId)).read_at
    expect(readAt).not.toBeNull()

    expect((await change(w.m1, taskId, 'accepted')).error).toBeNull()
    const after = await reviewRow(w.m2, taskId)
    expect(after.read_at).toBe(readAt)
    expect(after.resolution).toBe('accepted')
  })
})
