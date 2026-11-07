import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ilikeContains, quoteFilterValue } from '@/shared/api/postgrest-filter'

import { createTestUser, type TestUser } from '../../setup/supabase'

// The exact request shapes of the server-side lists (search through an aliased embed, or(),
// count exact, order keys) sent directly to PostgREST with hostile parameters. The client
// escaping is not a security boundary: whatever the search/sort/status, an executor must get
// only their own live rows, in rows and in counts.

const tag = `lsb${crypto.randomUUID().slice(0, 8)}`

let manager: TestUser
let e1: TestUser
let e2: TestUser
let objA: string
let objB: string
let e1Tasks: string[]
let e2Tasks: string[]

const raw = (u: TestUser) => u.client as unknown as SupabaseClient

const ASSIGNEE_SELECT =
  'id, title, status, created_at, assignee:profiles!tasks_assignee_id_fkey!inner(id, full_name), assignee_search:profiles!tasks_assignee_id_fkey()'
const OBJECT_SELECT =
  'id, title, status, created_at, object:objects!tasks_object_id_fkey!inner(id, name), object_search:objects!tasks_object_id_fkey()'

// Same composition as the object page / my-tasks queries.
function byObject(u: TestUser, objectId: string, search: string, head = false) {
  const pattern = ilikeContains(search)
  let q = raw(u)
    .from('tasks')
    .select(ASSIGNEE_SELECT, { count: 'exact', head })
    .eq('object_id', objectId)
  if (search !== '') {
    q = q
      .ilike('assignee_search.full_name', pattern)
      .or(`title.ilike.${quoteFilterValue(pattern)},assignee_search.not.is.null`)
  }
  return q
}

function mine(u: TestUser, assigneeId: string, search: string, head = false) {
  const pattern = ilikeContains(search)
  let q = raw(u)
    .from('tasks')
    .select(OBJECT_SELECT, { count: 'exact', head })
    .eq('assignee_id', assigneeId)
  if (search !== '') {
    q = q
      .ilike('object_search.name', pattern)
      .or(`title.ilike.${quoteFilterValue(pattern)},object_search.not.is.null`)
  }
  return q
}

function idsOf(data: unknown): string[] {
  return ((data ?? []) as { id: string }[]).map((r) => r.id)
}

async function createTask(objectId: string, title: string, assignee: TestUser): Promise<string> {
  const { data, error } = await manager.client
    .from('tasks')
    .insert({ object_id: objectId, title: `${tag} ${title}`, assignee_id: assignee.id })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

// Strings that would add filter conditions or wildcards if the escaping were wrong.
const HOSTILE = [
  `x",id.not.is.null,title.eq."`,
  `x"),or(id.not.is.null`,
  `\\",assignee_id.neq.00000000-0000-0000-0000-000000000000,title.eq.\\"`,
  `),assignee_search.not.is.null,(`,
  `x,title.not.is.null`,
  `x:y.not.is.null`,
  '%',
  '_',
  '\\',
  `%' or '1'='1`,
]

beforeAll(async () => {
  ;[manager, e1, e2] = await Promise.all([
    createTestUser('manager', `${tag}-m`),
    createTestUser('executor', `${tag}-x1`),
    createTestUser('executor', `${tag}-x2`),
  ])
  const { data, error } = await manager.client
    .from('objects')
    .insert([
      { name: `${tag} obj-a`, address: 'addr' },
      { name: `${tag} obj-b`, address: 'addr' },
    ])
    .select('id, name')
  if (error) throw error
  objA = data.find((o) => o.name.endsWith('obj-a'))?.id ?? ''
  objB = data.find((o) => o.name.endsWith('obj-b'))?.id ?? ''
  e1Tasks = [await createTask(objA, 'e1 one', e1), await createTask(objA, 'e1 two', e1)]
  // e2 has a task on the shared object A and the only tasks of object B.
  e2Tasks = [await createTask(objA, 'e2 shared', e2), await createTask(objB, 'e2 only-b', e2)]
}, 60_000)

afterAll(async () => {
  await Promise.allSettled(
    [...e1Tasks, ...e2Tasks].map((id) => manager.client.rpc('delete_task', { p_task_id: id })),
  )
  for (const id of [objA, objB]) await manager.client.rpc('delete_object', { p_object_id: id })
})

describe('object task list (production shape) for an executor', () => {
  it("searching the other executor's name on a shared object finds nothing, count 0", async () => {
    for (const head of [false, true]) {
      const res = await byObject(e1, objA, `${tag}-x2`, head)
      expect(res.error).toBeNull()
      expect(idsOf(res.data)).toEqual([])
      expect(res.count).toBe(0)
    }
  })

  it('a shared object without search shows only own tasks; count matches', async () => {
    const res = await byObject(e1, objA, '').range(0, 99)
    expect(res.error).toBeNull()
    expect(new Set(idsOf(res.data))).toEqual(new Set(e1Tasks))
    expect(res.count).toBe(e1Tasks.length)
  })

  it('a foreign object yields nothing whatever the search', async () => {
    for (const search of ['', tag, `${tag}-x2`, 'only-b']) {
      for (const head of [false, true]) {
        const res = await byObject(e1, objB, search, head)
        expect(res.error).toBeNull()
        expect(idsOf(res.data)).toEqual([])
        expect(res.count).toBe(0)
      }
    }
  })
})

describe('my-tasks list (production shape) with a forged assignee', () => {
  it('another executor id with or without the object search yields nothing', async () => {
    for (const search of ['', `${tag} obj-b`, tag]) {
      for (const head of [false, true]) {
        const res = await mine(e1, e2.id, search, head)
        expect(res.error).toBeNull()
        expect(idsOf(res.data)).toEqual([])
        expect(res.count).toBe(0)
      }
    }
  })
})

describe('hostile search strings cannot widen the result', () => {
  it('executor: only own tasks, and no literal match means no rows', async () => {
    for (const search of HOSTILE) {
      const own = await byObject(e1, objA, search)
      expect(own.error, search).toBeNull()
      expect(idsOf(own.data), search).toEqual([])
      expect(own.count, search).toBe(0)

      const my = await mine(e1, e1.id, search)
      expect(my.error, search).toBeNull()
      expect(idsOf(my.data), search).toEqual([])
      expect(my.count, search).toBe(0)
    }
  })

  it('manager: injected conditions are treated as literal text (0 rows, not all rows)', async () => {
    for (const search of HOSTILE) {
      for (const objectId of [objA, objB]) {
        const res = await byObject(manager, objectId, search)
        expect(res.error, search).toBeNull()
        expect(idsOf(res.data), search).toEqual([])
        expect(res.count, search).toBe(0)
      }
    }
  })
})

describe('ordering, status and embeds through raw REST', () => {
  it('ordering by columns outside the UI allowlist keeps the scope', async () => {
    for (const column of ['deleted_at', 'author_id', 'assignee_id', 'status_rank', 'object_id']) {
      const res = await raw(e1).from('tasks').select('id').order(column).limit(5000)
      expect(res.error, column).toBeNull()
      expect(new Set(idsOf(res.data)), column).toEqual(new Set(e1Tasks))
    }
  })

  it('an unknown order column or status value is an error without rows', async () => {
    const badOrder = await raw(e1).from('tasks').select('id').order('no_such_column')
    expect(badOrder.error).not.toBeNull()
    expect(badOrder.data).toBeNull()

    const badStatus = await raw(e1)
      .from('tasks')
      .select('id', { count: 'exact' })
      .in('status', ['new', 'not_a_status'])
    expect(badStatus.error).not.toBeNull()
    expect(badStatus.data).toBeNull()
    expect(badStatus.count ?? null).toBeNull()
  })

  it('objects -> tasks embed shows only own tasks; !inner on a foreign assignee is empty', async () => {
    const res = await raw(e1)
      .from('objects')
      .select('id, tasks(id, assignee_id)')
      .in('id', [objA, objB])
    expect(res.error).toBeNull()
    const rows = res.data as { id: string; tasks: { id: string; assignee_id: string }[] }[]
    expect(rows.map((r) => r.id)).toEqual([objA])
    expect(new Set(rows[0]?.tasks.map((t) => t.id))).toEqual(new Set(e1Tasks))

    const inner = await raw(e1)
      .from('objects')
      .select('id, tasks!inner(id)', { count: 'exact' })
      .eq('tasks.assignee_id', e2.id)
    expect(inner.error).toBeNull()
    expect(inner.data).toEqual([])
    expect(inner.count).toBe(0)
  })

  it('profiles embed filter cannot match a foreign assignee via own tasks', async () => {
    const res = await raw(e1)
      .from('tasks')
      .select('id, assignee_search:profiles!tasks_assignee_id_fkey()', { count: 'exact' })
      .eq('assignee_search.id', e2.id)
      .or('assignee_search.not.is.null')
    expect(res.error).toBeNull()
    expect(res.data).toEqual([])
    expect(res.count).toBe(0)
  })
})
