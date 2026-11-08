import { beforeAll, describe, expect, inject, it } from 'vitest'

import { anonClient, createTestUser, type TestUser } from '../../setup/supabase'

// Notification isolation through every backend path, bypassing the UI: REST (filters, count,
// HEAD, embedding), GraphQL, direct writes, the read RPCs, users without an effective role, anon
// and forged tokens; plus races of review decisions and of reassignment vs. status change.
// Every user sees only his own notifications. Users and rows are unique per run; assertions only
// touch rows created here (other files' managers also receive manager notifications).

let m1: TestUser
let m2: TestUser
let a: TestUser
let b: TestUser

const noPrivilege = { code: '42501' }

async function token(user: TestUser): Promise<string> {
  const { data, error } = await user.client.auth.getSession()
  if (error) throw error
  if (!data.session) throw new Error('no session')
  return data.session.access_token
}

/** Raw Data API request (no supabase-js), with the user's JWT or as anon. */
async function api(path: string, init: RequestInit = {}, bearer?: string): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('apikey', inject('supabasePublishableKey'))
  if (bearer) headers.set('Authorization', `Bearer ${bearer}`)
  return fetch(`${inject('supabaseUrl')}${path}`, { ...init, headers })
}

async function createObject(): Promise<string> {
  const { data, error } = await m1.client
    .from('objects')
    .insert({ name: `nb-object-${crypto.randomUUID()}`, address: 'nb address' })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

async function createTask(objectId: string, assignee: TestUser | { id: string }): Promise<string> {
  const { data, error } = await m1.client
    .from('tasks')
    .insert({
      object_id: objectId,
      title: `nb-task-${crypto.randomUUID()}`,
      assignee_id: assignee.id,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

async function move(user: TestUser, taskId: string, to: 'in_progress' | 'in_review') {
  const { error } = await user.client.rpc('change_task_status', {
    p_task_id: taskId,
    p_to_status: to,
  })
  if (error) throw error
}

interface Seen {
  id: string
  user_id: string
  kind: string
  read_at: string | null
  comment: string | null
  resolution: string | null
  resolved_by: string | null
}

/** Notifications of the given tasks as the user sees them (RLS). */
async function seen(user: TestUser, taskIds: string[]): Promise<Seen[]> {
  const { data, error } = await user.client
    .from('notifications')
    .select('id, user_id, kind, read_at, comment, resolution, resolved_by')
    .in('task_id', taskIds)
  if (error) throw error
  return data
}

beforeAll(async () => {
  ;[m1, m2, a, b] = await Promise.all([
    createTestUser('manager', 'nb-m1'),
    createTestUser('manager', 'nb-m2'),
    createTestUser('executor', 'nb-a'),
    createTestUser('executor', 'nb-b'),
  ])
})

describe('read isolation', () => {
  let objectId: string
  let taskA: string // A: assigned, taken into work, sent to review, returned with a comment
  let taskB: string
  let taskMoved: string // reassigned A -> B
  let idsA: string[]
  let idsB: string[]
  let idsM1: string[]
  const comment = `nb-secret-comment-${crypto.randomUUID()}`

  beforeAll(async () => {
    objectId = await createObject()
    ;[taskA, taskB, taskMoved] = await Promise.all([
      createTask(objectId, a),
      createTask(objectId, b),
      createTask(objectId, a),
    ])
    await move(a, taskA, 'in_progress')
    await move(a, taskA, 'in_review')
    const rework = await m1.client.rpc('change_task_status', {
      p_task_id: taskA,
      p_to_status: 'rework',
      p_comment: comment,
    })
    if (rework.error) throw rework.error
    const reassign = await m1.client.from('tasks').update({ assignee_id: b.id }).eq('id', taskMoved)
    if (reassign.error) throw reassign.error

    const all = [taskA, taskB, taskMoved]
    idsA = (await seen(a, all)).map((n) => n.id)
    idsB = (await seen(b, all)).map((n) => n.id)
    idsM1 = (await seen(m1, all)).map((n) => n.id)
    // Non-vacuous fixtures: A has assigned x2, rework, unassigned; B assigned x2; M1 in_progress, in_review.
    expect(idsA).toHaveLength(4)
    expect(idsB).toHaveLength(2)
    expect(idsM1).toHaveLength(2)
  })

  it('select=* returns only own rows for executors and managers', async () => {
    for (const user of [a, b, m1, m2]) {
      const { data, error } = await user.client.from('notifications').select('*').limit(1000)
      expect(error).toBeNull()
      expect(data?.length).toBeGreaterThan(0)
      expect(data?.every((n) => n.user_id === user.id)).toBe(true)
    }
  })

  it('foreign rows are invisible by user_id, id, task_id, or= and neq filters', async () => {
    const byUser = await b.client.from('notifications').select('id').eq('user_id', a.id)
    expect(byUser).toMatchObject({ error: null, data: [] })
    const byId = await b.client.from('notifications').select('id').in('id', idsA)
    expect(byId).toMatchObject({ error: null, data: [] })
    const byTask = await b.client.from('notifications').select('id').eq('task_id', taskA)
    expect(byTask).toMatchObject({ error: null, data: [] })
    const byOr = await b.client
      .from('notifications')
      .select('id')
      .or(`user_id.eq.${a.id},id.in.(${idsA.join(',')}),user_id.eq.${m1.id}`)
    expect(byOr).toMatchObject({ error: null, data: [] })
    const notMine = await b.client.from('notifications').select('id').neq('user_id', b.id)
    expect(notMine).toMatchObject({ error: null, data: [] })
  })

  it('a manager who sees the task does not see the assignee notification nor its comment', async () => {
    const rows = await seen(m1, [taskA])
    expect(rows.map((n) => n.kind).sort()).toEqual(['task_in_progress', 'task_in_review'])
    expect(rows.every((n) => n.user_id === m1.id && n.comment === null)).toBe(true)
    // The comment is readable only by its recipient.
    const own = await seen(a, [taskA])
    expect(own.filter((n) => n.kind === 'task_rework').map((n) => n.comment)).toEqual([comment])
  })

  it('count=exact (supabase-js head and raw HEAD) reveals no foreign rows', async () => {
    const foreign = await b.client
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', a.id)
    expect(foreign).toMatchObject({ error: null, count: 0 })
    const foreignIds = await b.client
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .in('id', idsA)
    expect(foreignIds).toMatchObject({ error: null, count: 0 })

    const own = await b.client.from('notifications').select('id').limit(1000)
    const total = await b.client.from('notifications').select('*', { count: 'exact', head: true })
    expect(total.count).toBe(own.data?.length)

    const head = await api(
      `/rest/v1/notifications?user_id=eq.${a.id}`,
      { method: 'HEAD', headers: { Prefer: 'count=exact' } },
      await token(b),
    )
    expect(head.status).toBe(200)
    expect(head.headers.get('content-range')).toBe('*/0')
  })

  it('embedding from tasks returns only own notifications', async () => {
    const asB = await b.client.from('tasks').select('id, notifications(id, user_id)').limit(1000)
    expect(asB.error).toBeNull()
    expect(asB.data?.length).toBeGreaterThan(0)
    expect(asB.data?.flatMap((t) => t.notifications).every((n) => n.user_id === b.id)).toBe(true)

    const asM1 = await m1.client
      .from('tasks')
      .select('id, notifications(id, user_id, comment)')
      .eq('id', taskA)
    expect(asM1.error).toBeNull()
    const embedded = asM1.data?.flatMap((t) => t.notifications) ?? []
    expect(embedded.map((n) => n.id).sort()).toEqual(
      idsM1.filter((id) => embedded.some((n) => n.id === id)).sort(),
    )
    expect(embedded).toHaveLength(2)
    expect(embedded.every((n) => n.user_id === m1.id && n.comment === null)).toBe(true)
  })

  it('embedding from profiles (recipient and actor FKs) returns only own notifications', async () => {
    const recipient = await m1.client
      .from('profiles')
      .select('id, notifications!notifications_user_id_fkey(id)')
      .eq('id', a.id)
    expect(recipient.error).toBeNull()
    expect(recipient.data).toEqual([{ id: a.id, notifications: [] }])

    // A is the actor of M1's and M2's in_progress / in_review notifications: M1 sees only his own.
    const actor = await m1.client
      .from('profiles')
      .select('id, notifications!notifications_actor_id_fkey(id, user_id)')
      .eq('id', a.id)
    expect(actor.error).toBeNull()
    const acted = actor.data?.flatMap((p) => p.notifications) ?? []
    expect(acted.length).toBeGreaterThanOrEqual(2)
    expect(acted.every((n) => n.user_id === m1.id)).toBe(true)
  })

  it('a previous assignee keeps only the title snapshot; the embedded task stays hidden', async () => {
    const { data, error } = await a.client
      .from('notifications')
      .select('kind, title_snapshot, tasks(id, title, description)')
      .eq('task_id', taskMoved)
    expect(error).toBeNull()
    expect(data?.map((n) => n.kind).sort()).toEqual(['task_assigned', 'task_unassigned'])
    // The generated type says non-null (FK is not null), but RLS hides the task: PostgREST gives null.
    expect(data?.map((n) => n.tasks)).toEqual([null, null])
    expect(data?.every((n) => n.title_snapshot.startsWith('nb-task-'))).toBe(true)
  })

  it('GraphQL returns no foreign notification (authenticated and anon)', async () => {
    const query = `{ notificationsCollection(first: 100, filter: { userId: { eq: "${a.id}" } }) {
      edges { node { id userId } } } }`
    for (const bearer of [await token(b), undefined]) {
      const response = await api(
        '/graphql/v1',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
        },
        bearer,
      )
      const text = await response.text()
      for (const id of idsA) expect(text).not.toContain(id)
      expect(text).not.toContain(a.id)
    }

    // Unfiltered query as B: whatever GraphQL returns, it is never another user's row.
    const own = await api(
      '/graphql/v1',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: '{ notificationsCollection(first: 100) { edges { node { id userId } } } }',
        }),
      },
      await token(b),
    )
    const body = (await own.json()) as {
      data?: { notificationsCollection?: { edges: { node: { userId: string } }[] } } | null
    }
    const nodes = body.data?.notificationsCollection?.edges ?? []
    expect(nodes.every((e) => e.node.userId === b.id)).toBe(true)
    for (const id of [...idsA, ...idsM1]) expect(JSON.stringify(body)).not.toContain(id)
  })
})

describe('no direct writes', () => {
  let taskId: string
  let ownId: string

  beforeAll(async () => {
    taskId = await createTask(await createObject(), a)
    const rows = await seen(a, [taskId])
    expect(rows).toHaveLength(1)
    ownId = rows[0]?.id ?? ''
  })

  it('INSERT (own or foreign recipient, forged read/resolution) → 42501', async () => {
    for (const userId of [a.id, b.id]) {
      const { error, status } = await a.client.from('notifications').insert({
        user_id: userId,
        kind: 'task_accepted',
        task_id: taskId,
        actor_id: m1.id,
        title_snapshot: 'nb-forged',
      })
      expect(error).toMatchObject(noPrivilege)
      expect(status).toBe(403)
    }
    const upsert = await a.client.from('notifications').upsert({
      id: ownId,
      user_id: a.id,
      kind: 'task_assigned',
      task_id: taskId,
      title_snapshot: 'x',
    })
    expect(upsert.error).toMatchObject(noPrivilege)
  })

  it('UPDATE read_at / user_id / title_snapshot → 42501 (read only through the RPCs)', async () => {
    const patches = [
      { read_at: new Date().toISOString() },
      { user_id: b.id },
      { title_snapshot: 'nb-forged' },
    ]
    for (const patch of patches) {
      const { error, status } = await a.client.from('notifications').update(patch).eq('id', ownId)
      expect(error).toMatchObject(noPrivilege)
      expect(status).toBe(403)
    }
    const foreign = await b.client.from('notifications').update({ read_at: null }).eq('id', ownId)
    expect(foreign.error).toMatchObject(noPrivilege)
  })

  it('DELETE own or foreign → 42501', async () => {
    for (const user of [a, b, m1]) {
      const { error, status } = await user.client.from('notifications').delete().eq('id', ownId)
      expect(error).toMatchObject(noPrivilege)
      expect(status).toBe(403)
    }
  })

  it('after all attempts the row is unchanged and still unread', async () => {
    const { data } = await a.client
      .from('notifications')
      .select('id, user_id, kind, read_at, title_snapshot')
      .eq('task_id', taskId)
    expect(data).toEqual([
      {
        id: ownId,
        user_id: a.id,
        kind: 'task_assigned',
        read_at: null,
        title_snapshot: expect.stringMatching(/^nb-task-/) as unknown,
      },
    ])
  })
})

describe('read RPCs never touch foreign rows', () => {
  let taskA: string
  let taskB: string
  let idA: string
  let idB: string

  const readAt = async (user: TestUser, id: string) =>
    (await user.client.from('notifications').select('read_at').eq('id', id).single()).data?.read_at

  beforeAll(async () => {
    const objectId = await createObject()
    ;[taskA, taskB] = await Promise.all([createTask(objectId, a), createTask(objectId, b)])
    idA = (await seen(a, [taskA]))[0]?.id ?? ''
    idB = (await seen(b, [taskB]))[0]?.id ?? ''
    expect(idA).not.toBe('')
    expect(idB).not.toBe('')
  })

  it('B marks A’s id (alone and mixed with his own): only B’s row is read', async () => {
    const foreign = await b.client.rpc('mark_notifications_read', { p_ids: [idA] })
    expect(foreign.error).toBeNull()
    expect(await readAt(a, idA)).toBeNull()

    const mixed = await b.client.rpc('mark_notifications_read', { p_ids: [idA, idB] })
    expect(mixed.error).toBeNull()
    expect(await readAt(a, idA)).toBeNull()
    expect(await readAt(b, idB)).not.toBeNull()
  })

  it('mark_all marks only the caller’s rows', async () => {
    const { error } = await b.client.rpc('mark_all_notifications_read')
    expect(error).toBeNull()
    expect(await readAt(a, idA)).toBeNull()
    const { count } = await b.client
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .is('read_at', null)
    expect(count).toBe(0)
  })

  it('invalid arguments are rejected before anything changes', async () => {
    const tooMany = Array.from({ length: 201 }, () => crypto.randomUUID())
    const big = await a.client.rpc('mark_notifications_read', { p_ids: [...tooMany, idA] })
    expect(big.error).toMatchObject({ code: '22023', message: 'too_many_ids' })
    const empty = await a.client.rpc('mark_notifications_read', {
      p_ids: null as unknown as string[],
    })
    expect(empty.error).toMatchObject({ code: '22023', message: 'ids_required' })
    const garbage = await api(
      '/rest/v1/rpc/mark_notifications_read',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_ids: [`${idA}' or true --`] }),
      },
      await token(a),
    )
    expect(garbage.status).toBe(400)
    expect(await readAt(a, idA)).toBeNull()
  })

  it('repeated and parallel marks are idempotent (first read time kept)', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => a.client.rpc('mark_notifications_read', { p_ids: [idA] })),
    )
    expect(results.every((r) => r.error === null)).toBe(true)
    const first = await readAt(a, idA)
    expect(first).not.toBeNull()
    expect((await a.client.rpc('mark_all_notifications_read')).error).toBeNull()
    expect((await a.client.rpc('mark_notifications_read', { p_ids: [idA] })).error).toBeNull()
    expect(await readAt(a, idA)).toBe(first)
  })
})

describe('user without an effective role (initial password not changed)', () => {
  let fresh: TestUser
  let taskId: string

  beforeAll(async () => {
    fresh = await createTestUser('executor', 'nb-fresh', { changePassword: false })
    taskId = await createTask(await createObject(), fresh)
  })

  it('sees 0 rows (select, filter by own id, count) and the RPCs are a no-op', async () => {
    const all = await fresh.client.from('notifications').select('id')
    expect(all).toMatchObject({ error: null, data: [] })
    const own = await fresh.client.from('notifications').select('id').eq('user_id', fresh.id)
    expect(own).toMatchObject({ error: null, data: [] })
    const count = await fresh.client
      .from('notifications')
      .select('*', { count: 'exact', head: true })
    expect(count).toMatchObject({ error: null, count: 0 })
    expect((await fresh.client.rpc('mark_all_notifications_read')).error).toBeNull()

    // After the password change the notification is visible and still unread.
    const { error } = await fresh.client.auth.updateUser({ password: `Pw-${crypto.randomUUID()}` })
    expect(error).toBeNull()
    const after = await seen(fresh, [taskId])
    expect(after.map((n) => [n.kind, n.read_at])).toEqual([['task_assigned', null]])
  })
})

describe('anon and forged tokens', () => {
  let ids: string[]

  beforeAll(async () => {
    const taskId = await createTask(await createObject(), a)
    ids = (await seen(a, [taskId])).map((n) => n.id)
    expect(ids).toHaveLength(1)
  })

  it('anon: select, count, insert and RPCs → 42501 / 401', async () => {
    const anon = anonClient()
    const select = await anon.from('notifications').select('id').in('id', ids)
    expect(select.error).toMatchObject(noPrivilege)
    expect(select.status).toBe(401)
    const count = await anon.from('notifications').select('*', { count: 'exact', head: true })
    expect(count.error).not.toBeNull()
    expect(count.count).toBeNull()
    const insert = await anon.from('notifications').insert({
      user_id: a.id,
      kind: 'task_accepted',
      task_id: crypto.randomUUID(),
      title_snapshot: 'nb-anon',
    })
    expect(insert.error).toMatchObject(noPrivilege)
    for (const call of [
      anon.rpc('mark_all_notifications_read'),
      anon.rpc('mark_notifications_read', { p_ids: ids }),
    ]) {
      const { error, status } = await call
      expect(error).toMatchObject(noPrivilege)
      expect(status).toBe(401)
    }
  })

  it('unsigned / tampered JWT claiming to be A is rejected (401), nothing leaks', async () => {
    const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const claims = {
      sub: a.id,
      role: 'authenticated',
      aud: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 600,
    }
    const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`
    // B's real signature over A's claims.
    const [header, , signature] = (await token(b)).split('.')
    const tampered = `${header ?? ''}.${b64(claims)}.${signature ?? ''}`
    for (const bearer of [unsigned, tampered]) {
      const response = await api(`/rest/v1/notifications?select=id,user_id`, {}, bearer)
      expect(response.status).toBe(401)
      const text = await response.text()
      for (const id of ids) expect(text).not.toContain(id)
    }
  })
})

describe('races', () => {
  const N = 4

  it(`accept ∥ return to rework (${N} tasks): one decision, one notification, resolutions agree`, async () => {
    const objectId = await createObject()
    const tasks = await Promise.all(Array.from({ length: N }, () => createTask(objectId, a)))
    for (const taskId of tasks) {
      await move(a, taskId, 'in_progress')
      await move(a, taskId, 'in_review')
    }

    const outcomes = await Promise.all(
      tasks.map(async (taskId) => {
        const [accept, rework] = await Promise.all([
          m1.client.rpc('change_task_status', { p_task_id: taskId, p_to_status: 'accepted' }),
          m2.client.rpc('change_task_status', {
            p_task_id: taskId,
            p_to_status: 'rework',
            p_comment: 'nb-race',
          }),
        ])
        return { taskId, accept, rework }
      }),
    )

    for (const { taskId, accept, rework } of outcomes) {
      expect([accept.error, rework.error].filter((e) => e === null)).toHaveLength(1)
      const loser = accept.error ?? rework.error
      expect(loser).toMatchObject({ code: 'P0001', message: 'transition_not_allowed' })
      const winner =
        accept.error === null
          ? { by: m1.id, kind: 'task_accepted', res: 'accepted' }
          : { by: m2.id, kind: 'task_rework', res: 'rework' }

      const forA = (await seen(a, [taskId])).map((n) => n.kind).sort()
      expect(forA).toEqual(['task_assigned', winner.kind].sort())

      for (const manager of [m1, m2]) {
        const reviews = (await seen(manager, [taskId])).filter((n) => n.kind === 'task_in_review')
        expect(reviews).toHaveLength(1)
        expect(reviews[0]).toMatchObject({ resolution: winner.res, resolved_by: winner.by })
        expect(reviews[0]?.read_at).not.toBeNull()
      }
    }
  })

  it(`reassignment ∥ status change by the old assignee (${N} tasks): consistent recipients`, async () => {
    const objectId = await createObject()
    const tasks = await Promise.all(Array.from({ length: N }, () => createTask(objectId, a)))

    const outcomes = await Promise.all(
      tasks.map(async (taskId) => {
        const [reassign, change] = await Promise.all([
          m1.client.from('tasks').update({ assignee_id: b.id }).eq('id', taskId).select('id'),
          a.client.rpc('change_task_status', { p_task_id: taskId, p_to_status: 'in_progress' }),
        ])
        return { taskId, reassign, change }
      }),
    )

    for (const { taskId, reassign, change } of outcomes) {
      expect(reassign.error).toBeNull()
      expect(reassign.data).toEqual([{ id: taskId }])
      if (change.error !== null) expect(change.error).toMatchObject({ message: 'task_not_found' })
      const moved = change.error === null

      const task = await m1.client
        .from('tasks')
        .select('status, assignee_id')
        .eq('id', taskId)
        .single()
      expect(task.data).toEqual({ status: moved ? 'in_progress' : 'new', assignee_id: b.id })

      expect((await seen(a, [taskId])).map((n) => n.kind).sort()).toEqual([
        'task_assigned',
        'task_unassigned',
      ])
      expect((await seen(b, [taskId])).map((n) => n.kind)).toEqual(['task_assigned'])
      const inProgress = (await seen(m1, [taskId])).filter((n) => n.kind === 'task_in_progress')
      expect(inProgress).toHaveLength(moved ? 1 : 0)
      // The old assignee can no longer see or move the task.
      const after = await a.client.rpc('change_task_status', {
        p_task_id: taskId,
        p_to_status: 'in_review',
      })
      expect(after.error).toMatchObject({ message: 'task_not_found' })
    }
  })
})
