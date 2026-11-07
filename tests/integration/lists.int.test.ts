import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest'

import { objectQueries } from '@/entities/object'
import {
  taskQueries,
  TASK_STATUS_ORDER,
  type MyTaskListParams,
  type ObjectTaskListParams,
  type TaskStatus,
} from '@/entities/task'
import { getSupabaseClient } from '@/shared/api'

import { createTestUser, type TestUser } from '../setup/supabase'

// The REAL list queries of the app (the queryFn of taskQueries / objectQueries) run against the local
// stack. The app singleton client is pointed at the local project through the env and receives the
// session of the test user before each call. Data carries a per-run prefix and is soft-deleted after.

const tag = `ls${crypto.randomUUID().slice(0, 8)}`
const WINDOW = { pageIndex: 0, pageSize: 25 }
const DEFAULT_SORT = { id: 'status', desc: false } as const

let manager: TestUser
let orderUser: TestUser // one task per status
let pageUser: TestUser // 25 tasks
let alice: TestUser
let bob: TestUser
let objOrder: string
let objPage: string
let objZeta: string
let objSearch: string
const taskIds: string[] = []
const objectIds: string[] = []
const byStatus = new Map<TaskStatus, string>()
const pageTaskIds: string[] = []
let aliceTask: string
let bobTask: string

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

async function runMine(user: TestUser, params: Partial<MyTaskListParams> = {}) {
  await actAs(user)
  const options = taskQueries.mine(user.id, {
    ...WINDOW,
    search: '',
    sort: DEFAULT_SORT,
    statuses: [],
    ...params,
  })
  return (options.queryFn as (c: unknown) => ReturnType<typeof Promise.resolve>)(ctx()) as Promise<{
    rows: { id: string; status: TaskStatus; title: string }[]
    total: number
  }>
}

async function runByObject(objectId: string, params: Partial<ObjectTaskListParams> = {}) {
  await actAs(manager)
  const options = taskQueries.byObject(objectId, {
    ...WINDOW,
    search: '',
    sort: DEFAULT_SORT,
    statuses: [],
    ...params,
  })
  return (options.queryFn as (c: unknown) => ReturnType<typeof Promise.resolve>)(ctx()) as Promise<{
    rows: { id: string; status: TaskStatus; assignee: { full_name: string } }[]
    total: number
  }>
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

async function createTasks(
  objectId: string,
  assignee: TestUser,
  titles: string[],
): Promise<string[]> {
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
  const { error } = await user.client.rpc('change_task_status', {
    p_task_id: id,
    p_to_status: to,
    p_comment: comment,
  })
  if (error) throw error
}

beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', inject('supabaseUrl'))
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', inject('supabasePublishableKey'))
  ;[manager, orderUser, pageUser, alice, bob] = await Promise.all([
    createTestUser('manager', `${tag}-m`),
    createTestUser('executor', `${tag}-o`),
    createTestUser('executor', `${tag}-p`),
    createTestUser('executor', `${tag}-alice`),
    createTestUser('executor', `${tag}-bob`),
  ])
  objOrder = await createObject(`${tag} order`)
  objPage = await createObject(`${tag} page`)
  objZeta = await createObject(`${tag} zeta-unique`)
  objSearch = await createObject(`${tag} search`)

  // One task per status for orderUser. Created in the reverse workflow order on purpose.
  for (const status of [...TASK_STATUS_ORDER].reverse()) {
    const [id] = await createTasks(objOrder, orderUser, [`${tag} ${status}`])
    if (id === undefined) throw new Error('task not created')
    byStatus.set(status, id)
    if (status === 'new') continue
    await change(orderUser, id, 'in_progress')
    if (status === 'in_progress') continue
    await change(orderUser, id, 'in_review')
    if (status === 'in_review') continue
    if (status === 'accepted') await change(manager, id, 'accepted')
    else await change(manager, id, 'rework', 'fix it')
  }

  // 25 tasks for pageUser: 24 on objPage and one on objZeta.
  pageTaskIds.push(
    ...(await createTasks(
      objPage,
      pageUser,
      Array.from({ length: 24 }, (_, i) => `${tag} page ${String(i).padStart(2, '0')}`),
    )),
    ...(await createTasks(objZeta, pageUser, [`${tag} zeta task`])),
  )

  // byObject: the same object, two assignees with different names.
  aliceTask = (await createTasks(objSearch, alice, [`${tag} for alice`])).join()
  bobTask = (await createTasks(objSearch, bob, [`${tag} for bob`])).join()
}, 120_000)

afterAll(async () => {
  vi.unstubAllEnvs()
  await Promise.allSettled(
    taskIds.map((id) => manager.client.rpc('delete_task', { p_task_id: id })),
  )
  await Promise.allSettled(
    objectIds.map((id) => manager.client.rpc('delete_object', { p_object_id: id })),
  )
}, 120_000)

describe('taskQueries.mine', () => {
  it('default order follows the workflow: rework, new, in_progress, in_review, accepted', async () => {
    const { rows, total } = await runMine(orderUser)
    expect(total).toBe(5)
    expect(rows.map((r) => r.status)).toEqual([...TASK_STATUS_ORDER])
    expect(rows.map((r) => r.id)).toEqual(TASK_STATUS_ORDER.map((s) => byStatus.get(s)))
  })

  it('descending status sort reverses the workflow order', async () => {
    const { rows } = await runMine(orderUser, { sort: { id: 'status', desc: true } })
    expect(rows.map((r) => r.status)).toEqual([...TASK_STATUS_ORDER].reverse())
  })

  it('the status filter returns only the selected statuses', async () => {
    const one = await runMine(orderUser, { statuses: ['in_review'] })
    expect(one.rows.map((r) => r.status)).toEqual(['in_review'])
    expect(one.total).toBe(1)

    const two = await runMine(orderUser, { statuses: ['accepted', 'new'] })
    expect(two.rows.map((r) => r.status)).toEqual(['new', 'accepted'])
    expect(two.total).toBe(2)
  })

  it('paginates 25 tasks as 10 / 10 / 5 with total 25 and no overlap', async () => {
    const pages = []
    for (const pageIndex of [0, 1, 2]) {
      pages.push(await runMine(pageUser, { pageIndex, pageSize: 10 }))
    }
    expect(pages.map((p) => p.rows.length)).toEqual([10, 10, 5])
    expect(pages.map((p) => p.total)).toEqual([25, 25, 25])
    const all = pages.flatMap((p) => p.rows.map((r) => r.id))
    expect(new Set(all).size).toBe(25)
    expect(new Set(all)).toEqual(new Set(pageTaskIds))
  })

  it('a page past the last one is empty but keeps the total', async () => {
    const result = await runMine(pageUser, { pageIndex: 3, pageSize: 10 })
    expect(result).toEqual({ rows: [], total: 25 })
    const far = await runMine(pageUser, { pageIndex: 40, pageSize: 10 })
    expect(far).toEqual({ rows: [], total: 25 })
  })

  it('searches by the object name (not only by the title)', async () => {
    const { rows, total } = await runMine(pageUser, { search: 'zeta-unique' })
    expect(total).toBe(1)
    expect(rows.map((r) => r.title)).toEqual([`${tag} zeta task`])
  })

  it('searches by the title and a miss gives an empty page with total 0', async () => {
    const hit = await runMine(pageUser, { search: `page 07` })
    expect(hit.total).toBe(1)
    const miss = await runMine(pageUser, { search: `${tag} nothing-like-this` })
    expect(miss).toEqual({ rows: [], total: 0 })
  })

  it('never returns tasks of another executor', async () => {
    const { rows, total } = await runMine(alice)
    expect(total).toBe(1)
    expect(rows.map((r) => r.id)).toEqual([aliceTask])
  })
})

describe('taskQueries.byObject', () => {
  it('searches by the assignee name', async () => {
    const { rows, total } = await runByObject(objSearch, { search: `${tag}-alice` })
    expect(total).toBe(1)
    expect(rows.map((r) => r.id)).toEqual([aliceTask])
  })

  it('without a search returns both assignees; sorting by assignee orders by full name', async () => {
    const asc = await runByObject(objSearch, { sort: { id: 'assignee', desc: false } })
    expect(asc.total).toBe(2)
    expect(asc.rows.map((r) => r.id)).toEqual([aliceTask, bobTask])
    const desc = await runByObject(objSearch, { sort: { id: 'assignee', desc: true } })
    expect(desc.rows.map((r) => r.id)).toEqual([bobTask, aliceTask])
  })

  it('orders an object tasks by the workflow by default and filters by status', async () => {
    const all = await runByObject(objOrder)
    expect(all.rows.map((r) => r.status)).toEqual([...TASK_STATUS_ORDER])

    const filtered = await runByObject(objOrder, { statuses: ['rework', 'accepted'] })
    expect(filtered.rows.map((r) => r.status)).toEqual(['rework', 'accepted'])
    expect(filtered.total).toBe(2)
  })

  it('paginates the object tasks and handles a page past the end', async () => {
    const first = await runByObject(objPage, { pageSize: 10 })
    expect(first.rows).toHaveLength(10)
    expect(first.total).toBe(24)
    const last = await runByObject(objPage, { pageIndex: 2, pageSize: 10 })
    expect(last.rows).toHaveLength(4)
    const beyond = await runByObject(objPage, { pageIndex: 5, pageSize: 10 })
    expect(beyond).toEqual({ rows: [], total: 24 })
  })
})

describe('objectQueries.list', () => {
  async function runObjects(params: {
    search?: string
    desc?: boolean
    sortId?: 'name' | 'address'
    pageIndex?: number
    pageSize?: number
  }) {
    await actAs(manager)
    const options = objectQueries.list({
      pageIndex: params.pageIndex ?? 0,
      pageSize: params.pageSize ?? 25,
      search: params.search ?? tag,
      sort: { id: params.sortId ?? 'name', desc: params.desc ?? false },
    })
    return (options.queryFn as (c: unknown) => ReturnType<typeof Promise.resolve>)(
      ctx(),
    ) as Promise<{
      rows: { id: string; name: string }[]
      total: number
    }>
  }

  it('searches by name, sorts ascending and descending, with the exact total', async () => {
    const asc = await runObjects({})
    expect(asc.total).toBe(4)
    const names = asc.rows.map((r) => r.name)
    expect(names).toEqual([...names].sort())
    const desc = await runObjects({ desc: true })
    expect(desc.rows.map((r) => r.id)).toEqual(asc.rows.map((r) => r.id).reverse())
  })

  it('paginates and returns an empty page past the end with the total', async () => {
    const first = await runObjects({ pageSize: 3 })
    const second = await runObjects({ pageSize: 3, pageIndex: 1 })
    expect(first.rows).toHaveLength(3)
    expect(second.rows).toHaveLength(1)
    expect(first.total).toBe(4)
    expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(4)
    expect(await runObjects({ pageSize: 3, pageIndex: 9 })).toEqual({ rows: [], total: 4 })
  })

  it('a search that matches nothing is empty', async () => {
    expect(await runObjects({ search: `${tag} nope-nope` })).toEqual({ rows: [], total: 0 })
  })
})
