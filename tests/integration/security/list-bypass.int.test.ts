import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { anonClient, createTestUser, type TestUser } from '../../setup/supabase'

// List endpoints (objects / tasks) hit directly through PostgREST with hostile parameters:
// other people's data must never leak through filters, ordering, keysets, big limits or counts;
// soft-deleted rows never show up in rows or counts; users who must still change the password
// get nothing; max_rows must not silently truncate paged requests. Data is tagged per run.

const tag = `lb${crypto.randomUUID().slice(0, 8)}`
const BULK = 1005

let manager: TestUser
let e1: TestUser
let e2: TestUser
let fresh: TestUser
let freshManager: TestUser
let objA: string
let objB: string
let objDeleted: string
let e1Tasks: string[]
let e2Tasks: string[]
let deletedTaskId: string
const bulkIds: string[] = []

// Untyped client: embeds with aliases are beyond the generated types.
const raw = (u: TestUser) => u.client as unknown as SupabaseClient

const ASSIGNEE = 'assignee:profiles!tasks_assignee_id_fkey!inner(id,full_name)'

function ids(data: unknown): string[] {
  return (data as { id: string }[]).map((r) => r.id)
}

async function createObjects(rows: { name: string; address: string }[]): Promise<string[]> {
  const { data, error } = await manager.client.from('objects').insert(rows).select('id')
  if (error) throw error
  return data.map((o) => o.id)
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

async function changeStatus(user: TestUser, taskId: string, to: 'in_progress' | 'in_review') {
  const { error } = await user.client.rpc('change_task_status', {
    p_task_id: taskId,
    p_to_status: to,
  })
  if (error) throw error
}

beforeAll(async () => {
  ;[manager, e1, e2, fresh, freshManager] = await Promise.all([
    createTestUser('manager', `${tag}-m`),
    createTestUser('executor', `${tag}-x1`),
    createTestUser('executor', `${tag}-x2`),
    createTestUser('executor', `${tag}-fx`, { changePassword: false }),
    createTestUser('manager', `${tag}-fm`, { changePassword: false }),
  ])
  ;[objA, objB, objDeleted] = (await createObjects([
    { name: `${tag} obj-a`, address: 'addr' },
    { name: `${tag} obj-b`, address: 'addr' },
    { name: `${tag} obj-deleted`, address: 'addr' },
  ])) as [string, string, string]

  // e1: three tasks in different statuses on object A; e2: two tasks (A and B).
  const t1 = await createTask(objA, 'e1 new', e1)
  const t2 = await createTask(objA, 'e1 progress', e1)
  const t3 = await createTask(objA, 'e1 review', e1)
  await changeStatus(e1, t2, 'in_progress')
  await changeStatus(e1, t3, 'in_progress')
  await changeStatus(e1, t3, 'in_review')
  e1Tasks = [t1, t2, t3]
  e2Tasks = [await createTask(objA, 'e2 a', e2), await createTask(objB, 'e2 b', e2)]

  // Soft-deleted task (e1, object A) and soft-deleted object (no tasks).
  deletedTaskId = await createTask(objA, 'e1 deleted', e1)
  const del = await manager.client.rpc('delete_task', { p_task_id: deletedTaskId })
  if (del.error) throw del.error
  const delObj = await manager.client.rpc('delete_object', { p_object_id: objDeleted })
  if (delObj.error) throw delObj.error
}, 60_000)

afterAll(async () => {
  // Soft delete (the only API way): tasks first, then the objects without active tasks.
  await Promise.allSettled(
    [...e1Tasks, ...e2Tasks].map((id) => manager.client.rpc('delete_task', { p_task_id: id })),
  )
  const objects = [objA, objB, ...bulkIds]
  for (let i = 0; i < objects.length; i += 50) {
    await Promise.allSettled(
      objects
        .slice(i, i + 50)
        .map((id) => manager.client.rpc('delete_object', { p_object_id: id })),
    )
  }
}, 120_000)

describe('executor cannot widen the task list', () => {
  const own = () => new Set(e1Tasks)

  it('plain list returns only own live tasks (no params, huge limit, wide Range)', async () => {
    for (const q of [
      raw(e1).from('tasks').select('id,assignee_id'),
      raw(e1).from('tasks').select('id,assignee_id').limit(5000),
      raw(e1).from('tasks').select('id,assignee_id').range(0, 4999),
    ]) {
      const { data, error } = await q
      expect(error).toBeNull()
      expect(new Set(ids(data))).toEqual(own())
      expect((data as { assignee_id: string }[]).every((r) => r.assignee_id === e1.id)).toBe(true)
    }
  })

  it("another object's id yields nothing", async () => {
    const { data, error } = await raw(e1).from('tasks').select('id').eq('object_id', objB)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('filtering by the other executor id or name yields nothing', async () => {
    const byId = await raw(e1).from('tasks').select('id').eq('assignee_id', e2.id)
    expect(byId.error).toBeNull()
    expect(byId.data).toEqual([])

    const byIdOr = await raw(e1)
      .from('tasks')
      .select('id')
      .or(`assignee_id.eq.${e2.id},title.ilike.*e2*`)
    expect(byIdOr.error).toBeNull()
    expect(byIdOr.data).toEqual([])

    const { data: prof } = await manager.client
      .from('profiles')
      .select('full_name')
      .eq('id', e2.id)
      .single()
    const name = prof?.full_name ?? e2.email
    const byName = await raw(e1)
      .from('tasks')
      .select(`id, ${ASSIGNEE}`)
      .ilike('assignee.full_name', `%${name}%`)
    expect(byName.error).toBeNull()
    expect(byName.data).toEqual([])
  })

  it('ordering by assignee(full_name) keeps the scope', async () => {
    const { data, error } = await raw(e1)
      .from('tasks')
      .select(`id, ${ASSIGNEE}`)
      .order('full_name', { referencedTable: 'assignee', ascending: false })
      .limit(5000)
    expect(error).toBeNull()
    expect(new Set(ids(data))).toEqual(own())
  })

  it('every status filter returns only own tasks', async () => {
    const statuses = ['new', 'in_progress', 'in_review', 'accepted', 'rework'] as const
    const seen: string[] = []
    for (const status of statuses) {
      const { data, error } = await raw(e1).from('tasks').select('id').eq('status', status)
      expect(error).toBeNull()
      for (const id of ids(data)) expect(own().has(id)).toBe(true)
      seen.push(...ids(data))
    }
    expect(new Set(seen)).toEqual(own())
  })

  it('crafted keyset or() cannot reach foreign rows', async () => {
    const orFilters = [
      `created_at.lt.2999-01-01T00:00:00Z,and(created_at.eq.2000-01-01T00:00:00Z,id.gt.00000000-0000-0000-0000-000000000000)`,
      `id.gt.00000000-0000-0000-0000-000000000000,assignee_id.neq.${e1.id}`,
      `assignee_id.eq.${e2.id},object_id.eq.${objB}`,
    ]
    for (const f of orFilters) {
      const { data, error } = await raw(e1).from('tasks').select('id').or(f).limit(5000)
      expect(error).toBeNull()
      for (const id of ids(data)) expect(own().has(id)).toBe(true)
    }
  })

  it('count exact (with and without head) counts only own live tasks', async () => {
    const withRows = await raw(e1).from('tasks').select('id', { count: 'exact' }).range(0, 4999)
    expect(withRows.error).toBeNull()
    expect(withRows.count).toBe(e1Tasks.length)

    const head = await raw(e1).from('tasks').select('id', { count: 'exact', head: true })
    expect(head.error).toBeNull()
    expect(head.count).toBe(e1Tasks.length)

    const foreign = await raw(e1)
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('assignee_id', e2.id)
    expect(foreign.count).toBe(0)

    const foreignObj = await raw(e1)
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('object_id', objB)
    expect(foreignObj.count).toBe(0)
  })

  it('objects list and count expose only objects with own live tasks', async () => {
    const { data, count, error } = await e1.client
      .from('objects')
      .select('id', { count: 'exact' })
      .range(0, 4999)
    expect(error).toBeNull()
    expect(ids(data)).toEqual([objA])
    expect(count).toBe(1)

    const head = await e1.client
      .from('objects')
      .select('id', { count: 'exact', head: true })
      .eq('id', objB)
    expect(head.count).toBe(0)
  })
})

describe('soft-deleted rows are invisible in rows and counts', () => {
  it('manager: deleted task and object are absent', async () => {
    const tasks = await manager.client
      .from('tasks')
      .select('id', { count: 'exact' })
      .like('title', `${tag}%`)
    expect(tasks.error).toBeNull()
    expect(ids(tasks.data)).not.toContain(deletedTaskId)
    expect(tasks.count).toBe(e1Tasks.length + e2Tasks.length)

    const objects = await manager.client
      .from('objects')
      .select('id', { count: 'exact' })
      .like('name', `${tag}%`)
    expect(objects.error).toBeNull()
    expect(ids(objects.data)).not.toContain(objDeleted)
    expect(objects.count).toBe(2)

    const head = await manager.client
      .from('objects')
      .select('id', { count: 'exact', head: true })
      .eq('id', objDeleted)
    expect(head.count).toBe(0)
  })

  it('executor: deleted task is absent from rows, count and by-id lookup', async () => {
    const byId = await e1.client.from('tasks').select('id').eq('id', deletedTaskId)
    expect(byId.data).toEqual([])
    const all = await e1.client.from('tasks').select('id', { count: 'exact', head: true })
    expect(all.count).toBe(e1Tasks.length)
  })
})

describe('users who must change the password get nothing', () => {
  it('executor and manager with must_change_password: 0 rows and count 0', async () => {
    for (const u of [fresh, freshManager]) {
      for (const table of ['tasks', 'objects', 'task_status_history'] as const) {
        const rows = await u.client.from(table).select('id', { count: 'exact' }).range(0, 4999)
        expect(rows.error).toBeNull()
        expect(rows.data).toEqual([])
        expect(rows.count).toBe(0)
        const head = await u.client.from(table).select('id', { count: 'exact', head: true })
        expect(head.count).toBe(0)
      }
    }
  })
})

describe('anon', () => {
  it('gets neither rows nor counts', async () => {
    for (const table of ['tasks', 'objects', 'profiles', 'task_status_history'] as const) {
      const res = await anonClient().from(table).select('id', { count: 'exact' })
      expect(res.data ?? []).toEqual([])
      expect(res.count ?? 0).toBe(0)
    }
  })
})

describe('max_rows does not silently truncate paged requests', () => {
  it('1005 objects: count is exact and range(1000, 1009) returns 5 rows', async () => {
    const rows = Array.from({ length: BULK }, (_, i) => ({
      name: `${tag}-bulk-${String(i).padStart(4, '0')}`,
      address: 'bulk',
    }))
    for (let i = 0; i < rows.length; i += 200) {
      bulkIds.push(...(await createObjects(rows.slice(i, i + 200))))
    }
    expect(bulkIds).toHaveLength(BULK)

    const bulk = () =>
      manager.client
        .from('objects')
        .select('id,name', { count: 'exact' })
        .like('name', `${tag}-bulk-%`)

    const head = await manager.client
      .from('objects')
      .select('id', { count: 'exact', head: true })
      .like('name', `${tag}-bulk-%`)
    expect(head.error).toBeNull()
    expect(head.count).toBe(BULK)

    const last = await bulk().order('name').order('id').range(1000, 1009)
    expect(last.error).toBeNull()
    expect(last.count).toBe(BULK)
    expect(last.data?.map((r) => r.name)).toEqual(
      [1000, 1001, 1002, 1003, 1004].map((i) => `${tag}-bulk-${i}`),
    )

    // An unpaged request is capped by max_rows (1000), while the count stays exact.
    const capped = await bulk().order('name').order('id')
    expect(capped.error).toBeNull()
    expect(capped.data).toHaveLength(1000)
    expect(capped.count).toBe(BULK)

    // A page past the end is an explicit error, not a silent empty result.
    const beyond = await bulk().order('name').order('id').range(1010, 1019)
    expect(beyond.error?.code).toBe('PGRST103')
  }, 120_000)
})
