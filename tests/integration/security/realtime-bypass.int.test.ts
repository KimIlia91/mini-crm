import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeAll, describe, expect, inject, it } from 'vitest'

import type { Database } from '@/shared/api/database.types'

import { anonClient, createTestUser, type TestUser } from '../../setup/supabase'

// Realtime channel authorization against the real local Realtime service, bypassing the UI:
// private joins to foreign / role topics, client sends (WebSocket and REST) into private channels,
// direct writes to realtime.messages through the Data API, and public channels named like private
// ones. Each test uses its own channels; "not received" is checked over a short quiet period,
// always next to a positive control proving that delivery works in the same setup.

type Client = SupabaseClient<Database>

interface Message {
  event: string
  payload: Record<string, unknown>
}

interface Joined {
  channel: RealtimeChannel
  status: string
  received: Message[]
}

const QUIET_MS = 3_000
const opened: { client: Client; channel: RealtimeChannel }[] = []

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

/** Joins a channel and resolves with its first terminal status (SUBSCRIBED / CHANNEL_ERROR / ...). */
async function join(client: Client, topic: string, isPrivate = true): Promise<Joined> {
  const received: Message[] = []
  const channel = client.channel(topic, {
    config: { private: isPrivate, broadcast: { self: true, ack: true } },
  })
  channel.on('broadcast', { event: '*' }, (message: { event: string; payload: unknown }) => {
    received.push({ event: message.event, payload: message.payload as Record<string, unknown> })
  })
  opened.push({ client, channel })
  const status = await new Promise<string>((resolve) => {
    const timer = setTimeout(() => {
      resolve('NO_STATUS')
    }, 10_000)
    channel.subscribe((s) => {
      clearTimeout(timer)
      resolve(s)
    })
  })
  return { channel, status, received }
}

async function waitFor(joined: Joined, predicate: (m: Message) => boolean, ms = 8_000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (joined.received.some(predicate)) return
    await sleep(50)
  }
  throw new Error(`expected message not received; got ${JSON.stringify(joined.received)}`)
}

/** A second, independent signed-in client of the same user (another browser tab/device). */
async function secondClient(user: TestUser): Promise<Client> {
  const client = createClient<Database>(inject('supabaseUrl'), inject('supabasePublishableKey'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  })
  if (error) throw error
  return client
}

async function token(user: TestUser): Promise<string> {
  const { data } = await user.client.auth.getSession()
  if (!data.session) throw new Error('no session')
  return data.session.access_token
}

const aboutTask = (taskId: string) => (m: Message) => m.event === 'task' && m.payload.id === taskId

let m1: TestUser
let m2: TestUser
let a: TestUser
let b: TestUser
let freshManager: TestUser
let freshExecutor: TestUser
let objectId: string

async function createTask(assignee: TestUser): Promise<string> {
  const { data, error } = await m1.client
    .from('tasks')
    .insert({ object_id: objectId, title: 'rb-task', assignee_id: assignee.id })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

/**
 * Positive control: creates tasks for A until the task hint of one of them reaches every control
 * listener. Realtime drops database broadcasts above its per-tenant rate limit (too_many_requests
 * on a busy shared stack), so a single lost hint is retried instead of being reported as a
 * failure; an authorization failure would never deliver. Returns every created task id.
 */
async function createTaskUntilDelivered(controls: Joined[], attempts = 4): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < attempts; i++) {
    const id = await createTask(a)
    ids.push(id)
    try {
      for (const control of controls) await waitFor(control, aboutTask(id), 4_000)
      return ids
    } catch {
      // Lost under the rate limit: try again with a new task.
    }
  }
  throw new Error(`no task hint delivered after ${String(attempts)} attempts`)
}

beforeAll(async () => {
  ;[m1, m2, a, b, freshManager, freshExecutor] = await Promise.all([
    createTestUser('manager', 'rb-m1'),
    createTestUser('manager', 'rb-m2'),
    createTestUser('executor', 'rb-a'),
    createTestUser('executor', 'rb-b'),
    createTestUser('manager', 'rb-fresh-m', { changePassword: false }),
    createTestUser('executor', 'rb-fresh-e', { changePassword: false }),
  ])
  const { data, error } = await m1.client
    .from('objects')
    .insert({ name: `rb-object-${crypto.randomUUID()}`, address: 'rb address' })
    .select('id')
    .single()
  if (error) throw error
  objectId = data.id
})

afterEach(async () => {
  const items = opened.splice(0)
  await Promise.all(items.map(({ client, channel }) => client.removeChannel(channel)))
  await Promise.all([...new Set(items.map((i) => i.client))].map((c) => c.realtime.disconnect()))
})

describe('private channel joins', () => {
  it('own user topic → SUBSCRIBED (executor, manager); manager role:manager → SUBSCRIBED', async () => {
    expect((await join(a.client, `user:${a.id}`)).status).toBe('SUBSCRIBED')
    expect((await join(m1.client, `user:${m1.id}`)).status).toBe('SUBSCRIBED')
    expect((await join(m2.client, 'role:manager')).status).toBe('SUBSCRIBED')
  })

  it('without an effective role nothing, not even the own topic; after the password change → SUBSCRIBED', async () => {
    const user = await createTestUser('executor', 'rb-activate', { changePassword: false })
    expect((await join(user.client, `user:${user.id}`)).status).toBe('CHANNEL_ERROR')

    const password = `Pw-${crypto.randomUUID()}`
    const { error } = await user.client.auth.updateUser({ password })
    expect(error).toBeNull()
    const fresh = await secondClient({ ...user, password })
    expect((await join(fresh, `user:${user.id}`)).status).toBe('SUBSCRIBED')
    expect((await join(fresh, 'role:manager')).status).toBe('CHANNEL_ERROR')
  })

  it.each([
    ['executor A → user:B', () => a.client, () => `user:${b.id}`],
    ['manager → another user user:A', () => m1.client, () => `user:${a.id}`],
    ['executor → role:manager', () => a.client, () => 'role:manager'],
    [
      'manager without changed password → role:manager',
      () => freshManager.client,
      () => 'role:manager',
    ],
    [
      'executor without changed password → own user: topic',
      () => freshExecutor.client,
      () => `user:${freshExecutor.id}`,
    ],
    [
      'manager without changed password → own user: topic',
      () => freshManager.client,
      () => `user:${freshManager.id}`,
    ],
    ['executor → role:executor (no such channel)', () => b.client, () => 'role:executor'],
    ['anon → user:A', () => anonClient(), () => `user:${a.id}`],
    ['anon → role:manager', () => anonClient(), () => 'role:manager'],
  ])('%s → CHANNEL_ERROR', async (_, client, topic) => {
    expect((await join(client(), topic())).status).toBe('CHANNEL_ERROR')
  })
})

describe('database hints reach only the authorized private channels', () => {
  it('task created for A: A and managers get ids-only hints, B and anon get nothing', async () => {
    const [ownA, ownB, managers] = await Promise.all([
      join(a.client, `user:${a.id}`),
      join(b.client, `user:${b.id}`),
      join(m1.client, 'role:manager'),
    ])
    expect([ownA.status, ownB.status, managers.status]).toEqual([
      'SUBSCRIBED',
      'SUBSCRIBED',
      'SUBSCRIBED',
    ])

    const taskIds = await createTaskUntilDelivered([ownA, managers])
    await waitFor(ownA, (m) => m.event === 'notification')

    // Payloads carry ids only (no title, comment, names).
    for (const m of [...ownA.received, ...managers.received]) {
      const keys = Object.keys(m.payload).sort()
      if (m.event === 'task') expect(keys).toEqual(['id', 'object_id'])
      // Realtime adds its own message id ("id") to database broadcasts that have none.
      if (m.event === 'notification') {
        expect(keys).toEqual(['id', 'ids', 'op'])
        expect(m.payload.ids).not.toContain(m.payload.id)
      }
      expect(JSON.stringify(m.payload)).not.toContain('rb-task')
    }

    await sleep(QUIET_MS)
    expect(taskIds.length).toBeGreaterThan(0)
    expect(ownB.received).toEqual([])
  })
})

describe('clients cannot broadcast into private channels', () => {
  it('WebSocket send by A into user:A reaches neither A’s other client nor A himself', async () => {
    const other = await secondClient(a)
    const [sender, receiver] = await Promise.all([
      join(a.client, `user:${a.id}`),
      join(other, `user:${a.id}`),
    ])
    expect([sender.status, receiver.status]).toEqual(['SUBSCRIBED', 'SUBSCRIBED'])

    const forged = { op: 'created', ids: [crypto.randomUUID()] }
    await sender.channel.send({ type: 'broadcast', event: 'notification', payload: forged })
    await sender.channel.send({ type: 'broadcast', event: 'task', payload: { id: 'x' } })

    // Positive control: a database hint arrives on both clients.
    await createTaskUntilDelivered([receiver, sender])
    await sleep(QUIET_MS)
    for (const joined of [sender, receiver]) {
      expect(
        joined.received.some((m) => JSON.stringify(m.payload).includes(forged.ids[0] ?? '')),
      ).toBe(false)
      expect(joined.received.some((m) => m.payload.id === 'x')).toBe(false)
    }
  })

  it('a manager cannot broadcast into role:manager for other managers', async () => {
    const [sender, receiver] = await Promise.all([
      join(m1.client, 'role:manager'),
      join(m2.client, 'role:manager'),
    ])
    expect([sender.status, receiver.status]).toEqual(['SUBSCRIBED', 'SUBSCRIBED'])
    await sender.channel.send({ type: 'broadcast', event: 'task', payload: { id: 'forged' } })

    await createTaskUntilDelivered([receiver])
    await sleep(QUIET_MS)
    expect(receiver.received.some((m) => m.payload.id === 'forged')).toBe(false)
  })

  it('REST broadcast (httpSend, also with persist) by the owner or by B never reaches A', async () => {
    const listener = await join(a.client, `user:${a.id}`)
    expect(listener.status).toBe('SUBSCRIBED')

    const attempts: unknown[] = []
    for (const [client, opts] of [
      [await secondClient(a), {}],
      [await secondClient(a), { persist: true }],
      [b.client, {}],
      [anonClient(), {}],
    ] as const) {
      const channel = client.channel(`user:${a.id}`, { config: { private: true } })
      opened.push({ client, channel })
      attempts.push(
        await channel
          .httpSend('notification', { op: 'created', ids: ['forged-http'] }, opts)
          .catch((e: unknown) => (e instanceof Error ? e.message : String(e))),
      )
    }
    // No INSERT policy on realtime.messages: every REST send is refused.
    expect(attempts).toEqual(['Unauthorized', 'Unauthorized', 'Unauthorized', 'Unauthorized'])

    await createTaskUntilDelivered([listener])
    await sleep(QUIET_MS)
    expect(listener.received.some((m) => JSON.stringify(m.payload).includes('forged-http'))).toBe(
      false,
    )
  })
})

describe('realtime.messages is not reachable through the Data API', () => {
  const headers = async (user?: TestUser, profile = 'realtime') => ({
    apikey: inject('supabasePublishableKey'),
    'Content-Type': 'application/json',
    'Accept-Profile': profile,
    'Content-Profile': profile,
    ...(user ? { Authorization: `Bearer ${await token(user)}` } : {}),
  })
  const row = () => ({
    topic: `user:${a.id}`,
    extension: 'broadcast',
    event: 'notification',
    payload: { op: 'created', ids: [] },
    private: true,
  })

  it.each([
    ['authenticated', () => b],
    ['anon', () => undefined],
  ])('%s: select / insert / update on realtime.messages → schema not exposed', async (_, who) => {
    const base = `${inject('supabaseUrl')}/rest/v1/messages`
    const responses = await Promise.all([
      fetch(`${base}?select=*`, { headers: await headers(who()) }),
      fetch(base, { method: 'POST', headers: await headers(who()), body: JSON.stringify(row()) }),
      fetch(`${base}?topic=eq.user:${a.id}`, {
        method: 'PATCH',
        headers: await headers(who()),
        body: JSON.stringify({ payload: {} }),
      }),
      fetch(`${inject('supabaseUrl')}/rest/v1/rpc/send`, {
        method: 'POST',
        headers: await headers(who()),
        body: JSON.stringify({ payload: {}, event: 'x', topic: `user:${a.id}`, private: true }),
      }),
    ])
    for (const response of responses) {
      expect(response.status).toBe(406)
      expect(await response.json()).toMatchObject({ code: 'PGRST106' })
    }
  })

  it('messages / send are not in the public schema either', async () => {
    const select = await fetch(`${inject('supabaseUrl')}/rest/v1/messages?select=*`, {
      headers: await headers(b, 'public'),
    })
    expect(select.status).toBe(404)
    const send = await fetch(`${inject('supabaseUrl')}/rest/v1/rpc/send`, {
      method: 'POST',
      headers: await headers(b, 'public'),
      body: JSON.stringify({ payload: {}, event: 'x', topic: `user:${a.id}`, private: true }),
    })
    expect(send.status).toBe(404)
  })
})

describe('public channels named like private topics', () => {
  // The local stack allows public channels (hosted: "Allow public access" must be disabled).
  // Public and private channels of the same name are separate: database hints are private only,
  // and a public send never reaches a private subscriber.
  it('public user:A / role:manager get no DB hints; a public send does not reach A', async () => {
    const [privateA, publicA, publicManagers, publicSender] = await Promise.all([
      join(a.client, `user:${a.id}`),
      join(b.client, `user:${a.id}`, false),
      join(anonClient(), 'role:manager', false),
      join(anonClient(), `user:${a.id}`, false),
    ])
    expect([privateA, publicA, publicManagers, publicSender].map((j) => j.status)).toEqual([
      'SUBSCRIBED',
      'SUBSCRIBED',
      'SUBSCRIBED',
      'SUBSCRIBED',
    ])

    const forged = { op: 'created', ids: ['forged-public'] }
    await publicSender.channel.send({ type: 'broadcast', event: 'notification', payload: forged })
    // Control: the public send works between public subscribers.
    await waitFor(publicA, (m) => JSON.stringify(m.payload).includes('forged-public'))

    await createTaskUntilDelivered([privateA])
    await sleep(QUIET_MS)
    expect(publicA.received.filter((m) => m.event !== 'notification')).toEqual([])
    expect(publicA.received).toHaveLength(1)
    expect(publicManagers.received).toEqual([])
    expect(privateA.received.some((m) => JSON.stringify(m.payload).includes('forged-public'))).toBe(
      false,
    )
  })
})
