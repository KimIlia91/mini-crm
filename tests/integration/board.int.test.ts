import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest'

import { objectQueries, DEFAULT_OBJECT_SORT } from '@/entities/object'
import { taskQueries, TASK_STATUS_ORDER, type TaskStatus } from '@/entities/task'
import { getSupabaseClient } from '@/shared/api'

import { createTestUser, type TestUser } from '../setup/supabase'

// The REAL board column query of the app runs against the local stack as each role. Direct rpc
// calls prove that the database, not the UI, decides who may move a card.

const tag = `bd${crypto.randomUUID().slice(0, 8)}`

let manager: TestUser
let alice: TestUser
let bob: TestUser
let objMain: string
let objOnlyBob: string
let objLimit: string
const taskIds: string[] = []
const objectIds: string[] = []

interface BoardRow {
  id: string
  title: string
  status: TaskStatus
  created_at: string
  assignee_id: string
  object: { id: string; name: string }
  assignee: { id: string; full_name: string }
}

async function actAs(user: TestUser): Promise<void> {
  const { data } = await user.client.auth.getSession()
  if (!data.session) throw new Error('test user has no session')
  const { error } = await getSupabaseClient().auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  })
  if (error) throw error
}

const ctx = () => ({ signal: new AbortController().signal, meta: undefined })

async function column(
  user: TestUser,
  status: TaskStatus,
  filter?: readonly string[],
  limit = 20,
): Promise<{ rows: BoardRow[]; total: number }> {
  await actAs(user)
  const options = taskQueries.boardColumn({ status, objectIds: filter, limit })
  return (options.queryFn as (c: unknown) => Promise<{ rows: BoardRow[]; total: number }>)(ctx())
}

async function totals(
  user: TestUser,
  filter?: readonly string[],
): Promise<Record<TaskStatus, number>> {
  const entries = await Promise.all(
    TASK_STATUS_ORDER.map(async (status) => [status, (await column(user, status, filter)).total]),
  )
  return Object.fromEntries(entries) as Record<TaskStatus, number>
}

async function createObject(name: string): Promise<string> {
  const { data, error } = await manager.client
    .from('objects')
    .insert({ name, address: 'addr' })
    .select('id')
    .single()
  if (error) throw error
  objectIds.push(data.id)
  return data.id
}

async function createTasks(objectId: string, assignee: TestUser, titles: string[]) {
  const { data, error } = await manager.client
    .from('tasks')
    .insert(titles.map((title) => ({ object_id: objectId, title, assignee_id: assignee.id })))
    .select('id')
  if (error) throw error
  const ids = data.map((t) => t.id)
  taskIds.push(...ids)
  return ids
}

async function change(user: TestUser, id: string, to: TaskStatus, comment?: string) {
  return user.client.rpc('change_task_status', {
    p_task_id: id,
    p_to_status: to,
    p_comment: comment,
  })
}

async function mustChange(user: TestUser, id: string, to: TaskStatus, comment?: string) {
  const { error } = await change(user, id, to, comment)
  if (error) throw error
}

async function toStatus(id: string, assignee: TestUser, target: TaskStatus) {
  const path: Record<TaskStatus, [TestUser, TaskStatus, string?][]> = {
    new: [],
    in_progress: [[assignee, 'in_progress']],
    in_review: [
      [assignee, 'in_progress'],
      [assignee, 'in_review'],
    ],
    rework: [
      [assignee, 'in_progress'],
      [assignee, 'in_review'],
      [manager, 'rework', 'fix it'],
    ],
    accepted: [
      [assignee, 'in_progress'],
      [assignee, 'in_review'],
      [manager, 'accepted'],
    ],
  }
  for (const [user, to, comment] of path[target]) await mustChange(user, id, to, comment)
}

async function historyCount(taskId: string): Promise<number> {
  const { count, error } = await manager.client
    .from('task_status_history')
    .select('id', { count: 'exact', head: true })
    .eq('task_id', taskId)
  if (error) throw error
  return count ?? 0
}

async function statusOf(taskId: string): Promise<TaskStatus> {
  const { data, error } = await manager.client
    .from('tasks')
    .select('status')
    .eq('id', taskId)
    .single()
  if (error) throw error
  return data.status
}

async function newTask(assignee: TestUser, target: TaskStatus = 'new', object = objMain) {
  const [id] = await createTasks(object, assignee, [`${tag} ${target} ${crypto.randomUUID()}`])
  if (id === undefined) throw new Error('task not created')
  await toStatus(id, assignee, target)
  return id
}

const ALICE_PLAN: Record<TaskStatus, number> = {
  new: 2,
  in_progress: 1,
  in_review: 1,
  rework: 1,
  accepted: 1,
}
const BOB_PLAN: Record<TaskStatus, number> = {
  new: 1,
  in_progress: 1,
  in_review: 0,
  rework: 0,
  accepted: 0,
}

beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', inject('supabaseUrl'))
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', inject('supabasePublishableKey'))
  ;[manager, alice, bob] = await Promise.all([
    createTestUser('manager', `${tag}-m`),
    createTestUser('executor', `${tag}-alice`),
    createTestUser('executor', `${tag}-bob`),
  ])
  objMain = await createObject(`${tag} main`)
  objOnlyBob = await createObject(`${tag} only-bob`)
  objLimit = await createObject(`${tag} limit`)

  for (const status of TASK_STATUS_ORDER) {
    for (let i = 0; i < ALICE_PLAN[status]; i++) await newTask(alice, status)
    for (let i = 0; i < BOB_PLAN[status]; i++) await newTask(bob, status)
  }
  await createTasks(objOnlyBob, bob, [`${tag} bob private`])

  const removed = await newTask(alice, 'new')
  const { error } = await manager.client.rpc('delete_task', { p_task_id: removed })
  if (error) throw error

  for (let batch = 0; batch < 5; batch++) {
    await createTasks(
      objLimit,
      alice,
      Array.from({ length: 5 }, (_, i) => `${tag} limit ${String(batch * 5 + i)}`),
    )
  }
}, 180_000)

afterAll(async () => {
  vi.unstubAllEnvs()
  await Promise.allSettled(
    taskIds.map((id) => manager.client.rpc('delete_task', { p_task_id: id })),
  )
  await Promise.allSettled(
    objectIds.map((id) => manager.client.rpc('delete_object', { p_object_id: id })),
  )
}, 120_000)

describe('board columns: visibility and totals', () => {
  it('manager filtered by object gets exact totals per status', async () => {
    const result = await totals(manager, [objMain])
    expect(result).toEqual({
      new: ALICE_PLAN.new + BOB_PLAN.new,
      in_progress: ALICE_PLAN.in_progress + BOB_PLAN.in_progress,
      in_review: 1,
      rework: 1,
      accepted: 1,
    })
  })

  it('manager sees tasks of every executor in a column', async () => {
    const { rows } = await column(manager, 'new', [objMain])
    expect(new Set(rows.map((r) => r.assignee_id))).toEqual(new Set([alice.id, bob.id]))
    expect(rows.every((r) => r.status === 'new')).toBe(true)
  })

  it('executor sees only own tasks and the total does not count another executor in the same object', async () => {
    const result = await totals(alice, [objMain])
    expect(result).toEqual(ALICE_PLAN)
    const { rows, total } = await column(alice, 'new', [objMain])
    expect(total).toBe(ALICE_PLAN.new)
    expect(rows).toHaveLength(ALICE_PLAN.new)
    expect(rows.every((r) => r.assignee_id === alice.id)).toBe(true)
  })

  it('executor without filter does not count other executors either', async () => {
    const { rows } = await column(bob, 'new')
    expect(rows.every((r) => r.assignee_id === bob.id)).toBe(true)
    const own = await column(bob, 'new', [objOnlyBob])
    expect(own.total).toBe(1)
  })

  it('executor filtering an object without own tasks gets [] and 0', async () => {
    for (const status of TASK_STATUS_ORDER) {
      const { rows, total } = await column(alice, status, [objOnlyBob])
      expect(rows).toEqual([])
      expect(total).toBe(0)
    }
  })

  it('a soft-deleted task is neither shown nor counted', async () => {
    const id = await newTask(alice, 'accepted')
    const before = await column(alice, 'accepted', [objMain])
    expect(before.rows.map((r) => r.id)).toContain(id)
    const { error } = await manager.client.rpc('delete_task', { p_task_id: id })
    expect(error).toBeNull()
    const after = await column(alice, 'accepted', [objMain])
    expect(after.rows.map((r) => r.id)).not.toContain(id)
    expect(after.total).toBe(before.total - 1)
    const asManager = await column(manager, 'accepted', [objMain])
    expect(asManager.rows.map((r) => r.id)).not.toContain(id)
  })

  it('embeds object and assignee are filled for an executor', async () => {
    const { rows } = await column(alice, 'new', [objMain])
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.object.id).toBe(objMain)
      expect(row.object.name).toBe(`${tag} main`)
      expect(row.assignee.id).toBe(alice.id)
      expect(row.assignee.full_name).not.toBe('')
    }
  })
})

describe('board columns: order and limit', () => {
  it('orders by created_at desc, then id desc', async () => {
    const { rows } = await column(manager, 'new', [objLimit], 25)
    expect(rows).toHaveLength(25)
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]
      const cur = rows[i]
      if (!prev || !cur) throw new Error('missing row')
      const prevTime = Date.parse(prev.created_at)
      const curTime = Date.parse(cur.created_at)
      expect(prevTime >= curTime).toBe(true)
      if (prevTime === curTime) expect(prev.id > cur.id).toBe(true)
    }
  })

  it('limit 20 of 25 returns the 20 newest and total 25', async () => {
    const { data, error } = await manager.client
      .from('tasks')
      .select('id')
      .eq('object_id', objLimit)
      .eq('status', 'new')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
    if (error) throw error
    expect(data).toHaveLength(25)
    const { rows, total } = await column(manager, 'new', [objLimit], 20)
    expect(total).toBe(25)
    expect(rows.map((r) => r.id)).toEqual(data.slice(0, 20).map((r) => r.id))
  })

  it('the same limit works for the executor and a larger limit returns all', async () => {
    const first = await column(alice, 'new', [objLimit], 20)
    expect(first.rows).toHaveLength(20)
    expect(first.total).toBe(25)
    const all = await column(alice, 'new', [objLimit], 100)
    expect(all.rows).toHaveLength(25)
  })
})

describe('objectQueries.list per role (board filter options)', () => {
  async function names(user: TestUser): Promise<string[]> {
    await actAs(user)
    const options = objectQueries.list({
      pageIndex: 0,
      pageSize: 100,
      search: tag,
      sort: DEFAULT_OBJECT_SORT,
    })
    const result = await (
      options.queryFn as (c: unknown) => Promise<{ rows: { name: string }[]; total: number }>
    )(ctx())
    return result.rows.map((r) => r.name)
  }

  it('manager sees every object', async () => {
    const result = await names(manager)
    expect(result).toEqual(
      expect.arrayContaining([`${tag} main`, `${tag} only-bob`, `${tag} limit`]),
    )
  })

  it('executor sees only objects with own tasks', async () => {
    const result = await names(alice)
    expect(result).toEqual(expect.arrayContaining([`${tag} main`, `${tag} limit`]))
    expect(result).not.toContain(`${tag} only-bob`)
  })
})

describe('direct rpc bypass of the board', () => {
  it('an executor moving a foreign task gets task_not_found and no history row', async () => {
    const id = await newTask(alice, 'new')
    const before = await historyCount(id)
    const { error } = await change(bob, id, 'in_progress')
    expect(error?.message).toContain('task_not_found')
    expect(await statusOf(id)).toBe('new')
    expect(await historyCount(id)).toBe(before)
  })

  it.each<TaskStatus>(['accepted', 'rework'])(
    'an executor moving own in_review task to %s gets transition_not_allowed',
    async (to) => {
      const id = await newTask(alice, 'in_review')
      const before = await historyCount(id)
      const { error } = await change(alice, id, to, 'self')
      expect(error?.message).toContain('transition_not_allowed')
      expect(await statusOf(id)).toBe('in_review')
      expect(await historyCount(id)).toBe(before)
    },
  )

  it('a manager moving an in_progress task to in_review gets transition_not_allowed', async () => {
    const id = await newTask(alice, 'in_progress')
    const before = await historyCount(id)
    const { error } = await change(manager, id, 'in_review')
    expect(error?.message).toContain('transition_not_allowed')
    expect(await statusOf(id)).toBe('in_progress')
    expect(await historyCount(id)).toBe(before)
  })

  it.each([undefined, '', ' \t\n '])(
    'rework without a comment (%j) gets comment_required and changes nothing',
    async (comment) => {
      const id = await newTask(alice, 'in_review')
      const before = await historyCount(id)
      const { error } = await change(manager, id, 'rework', comment)
      expect(error?.message).toContain('comment_required')
      expect(await statusOf(id)).toBe('in_review')
      expect(await historyCount(id)).toBe(before)
    },
  )

  it('two parallel identical requests: exactly one succeeds, the other is transition_not_allowed, one history row', async () => {
    const id = await newTask(alice, 'new')
    const before = await historyCount(id)
    const results = await Promise.all([
      change(alice, id, 'in_progress'),
      change(alice, id, 'in_progress'),
    ])
    const failures = results.filter((r) => r.error !== null)
    expect(failures).toHaveLength(1)
    expect(failures[0]?.error.message).toContain('transition_not_allowed')
    expect(await statusOf(id)).toBe('in_progress')
    expect(await historyCount(id)).toBe(before + 1)
  })

  it('the board reflects the move: the card leaves the old column and appears in the new one', async () => {
    const id = await newTask(alice, 'new')
    await mustChange(alice, id, 'in_progress')
    const oldColumn = await column(alice, 'new', [objMain], 100)
    const newColumn = await column(alice, 'in_progress', [objMain], 100)
    expect(oldColumn.rows.map((r) => r.id)).not.toContain(id)
    expect(newColumn.rows.map((r) => r.id)).toContain(id)
  })
})

describe('boardColumn limit validation', () => {
  it.each([0, 101, 1.5, -1])('limit %s fails with RangeError before any request', async (limit) => {
    await actAs(manager)
    const options = taskQueries.boardColumn({ status: 'new', limit })
    const run = options.queryFn as (c: unknown) => Promise<unknown>
    await expect(Promise.resolve().then(() => run(ctx()))).rejects.toBeInstanceOf(RangeError)
  })
})

describe('board columns: several objects', () => {
  let objX: string
  let objY: string
  let objZ: string

  beforeAll(async () => {
    ;[objX, objY, objZ] = await Promise.all([
      createObject(`${tag} multi-x`),
      createObject(`${tag} multi-y`),
      createObject(`${tag} multi-z`),
    ])
    await newTask(alice, 'new', objX)
    await newTask(alice, 'new', objX)
    await newTask(bob, 'new', objX)
    await newTask(alice, 'in_progress', objX)
    for (let i = 0; i < 3; i++) await newTask(alice, 'new', objY)
    for (let i = 0; i < 2; i++) await newTask(bob, 'new', objZ)
  }, 120_000)

  const sum = (a: Record<TaskStatus, number>, b: Record<TaskStatus, number>) =>
    Object.fromEntries(TASK_STATUS_ORDER.map((s) => [s, a[s] + b[s]])) as Record<TaskStatus, number>

  it('manager totals for two objects equal the sum of exactly those objects', async () => {
    const both = await totals(manager, [objX, objY])
    expect(both).toEqual(sum(await totals(manager, [objX]), await totals(manager, [objY])))
    expect(both).toEqual({ new: 6, in_progress: 1, in_review: 0, rework: 0, accepted: 0 })
  })

  it('does not count an object that is not selected', async () => {
    const withZ = await totals(manager, [objX, objY, objZ])
    expect(withZ.new).toBe(8)
    expect((await totals(manager, [objX, objY])).new).toBe(6)
  })

  it('the order of the selected ids does not matter', async () => {
    const first = await column(manager, 'new', [objX, objY], 100)
    const second = await column(manager, 'new', [objY, objX], 100)
    expect(second.total).toBe(first.total)
    expect(second.rows.map((r) => r.id)).toEqual(first.rows.map((r) => r.id))
  })

  it('rows of a two-object column belong to the selected objects only', async () => {
    const { rows } = await column(manager, 'new', [objX, objY], 100)
    expect(rows).toHaveLength(6)
    expect(new Set(rows.map((r) => r.object.id))).toEqual(new Set([objX, objY]))
  })

  it('an executor with two objects sees only own tasks and own counts', async () => {
    const result = await totals(alice, [objX, objZ])
    expect(result).toEqual({ new: 2, in_progress: 1, in_review: 0, rework: 0, accepted: 0 })
    const { rows } = await column(alice, 'new', [objX, objZ], 100)
    expect(rows.every((r) => r.assignee_id === alice.id)).toBe(true)
    expect(rows.map((r) => r.object.id)).not.toContain(objZ)
  })

  it('a foreign object among the selected adds no rows and no count for an executor', async () => {
    const withForeign = await totals(alice, [objY, objZ])
    expect(withForeign).toEqual(await totals(alice, [objY]))
    expect(withForeign.new).toBe(3)
  })

  it('only foreign objects selected gives an empty board for an executor', async () => {
    for (const status of TASK_STATUS_ORDER) {
      const { rows, total } = await column(alice, status, [objZ])
      expect(rows).toEqual([])
      expect(total).toBe(0)
    }
  })

  it('an empty selection means all objects', async () => {
    expect(await totals(alice, [])).toEqual(await totals(alice))
  })
})
