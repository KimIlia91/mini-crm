import { REALTIME_SUBSCRIBE_STATES, type RealtimeChannel } from '@supabase/supabase-js'

import { createTestUser, type TestUser } from './supabase'

export interface Received {
  event: string
  payload: Record<string, unknown>
}

export interface Listener {
  readonly received: Received[]
  /** Resolves with the first received message matching the predicate, or rejects on timeout. */
  waitFor: (predicate: (m: Received) => boolean, timeoutMs?: number) => Promise<Received>
  /** Waits `ms` and returns the messages matching the predicate (used for "nothing arrives"). */
  quietPeriod: (predicate: (m: Received) => boolean, ms?: number) => Promise<Received[]>
}

const open: { user: TestUser; channel: RealtimeChannel }[] = []

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * Subscribes the user to a private broadcast topic and resolves only after SUBSCRIBED (the daily
 * partition of realtime.messages is created on connect, so sending before that would lose hints).
 */
export async function listen(
  user: TestUser,
  topic: string,
  events: readonly string[],
  timeoutMs = 10_000,
): Promise<Listener> {
  const received: Received[] = []
  const channel = user.client.channel(topic, { config: { private: true } })
  for (const event of events) {
    channel.on('broadcast', { event }, (message) => {
      received.push({ event, payload: message.payload as Record<string, unknown> })
    })
  }
  open.push({ user, channel })

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`channel ${topic} was not subscribed in ${timeoutMs} ms`))
    }, timeoutMs)
    channel.subscribe((status, error) => {
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        clearTimeout(timer)
        resolve()
      } else {
        clearTimeout(timer)
        reject(new Error(`channel ${topic}: ${status} ${error?.message ?? ''}`))
      }
    })
  })

  return {
    received,
    async waitFor(predicate, wait = 20_000) {
      const deadline = Date.now() + wait
      for (;;) {
        const hit = received.find(predicate)
        if (hit) return hit
        if (Date.now() > deadline) {
          throw new Error(
            `no matching message on ${topic} in ${wait} ms; got ${JSON.stringify(received)}`,
          )
        }
        await sleep(50)
      }
    },
    async quietPeriod(predicate, ms = 1_500) {
      await sleep(ms)
      return received.filter(predicate)
    },
  }
}

/** Removes every channel opened by `listen` and closes the sockets. Call in afterEach. */
export async function closeAllChannels(): Promise<void> {
  const items = open.splice(0)
  await Promise.all(items.map(({ user, channel }) => user.client.removeChannel(channel)))
  await Promise.all(items.map(({ user }) => user.client.realtime.disconnect()))
}

/** Predicate: a hint of this event about the given row id. */
export const about = (event: string, id: string) => (m: Received) =>
  m.event === event && m.payload.id === id

/** Predicate: a notification hint whose ids include the given id. */
export const notificationWith = (op: 'created' | 'updated', id?: string) => (m: Received) =>
  m.event === 'notification' &&
  m.payload.op === op &&
  (id === undefined || (Array.isArray(m.payload.ids) && m.payload.ids.includes(id)))

export interface World {
  m1: TestUser
  m2: TestUser
  e1: TestUser
  e2: TestUser
  objectId: string
  createTask: (assignee: TestUser, title?: string) => Promise<string>
}

/** Fresh users (two managers, two executors) and an object, unique per call. */
export async function createWorld(): Promise<World> {
  const [m1, m2, e1, e2] = await Promise.all([
    createTestUser('manager', 'rt-m1'),
    createTestUser('manager', 'rt-m2'),
    createTestUser('executor', 'rt-e1'),
    createTestUser('executor', 'rt-e2'),
  ])
  const { data, error } = await m1.client
    .from('objects')
    .insert({ name: `rt-object-${crypto.randomUUID()}`, address: 'rt address' })
    .select('id')
    .single()
  if (error) throw error
  const objectId = data.id
  const createTask = async (assignee: TestUser, title = 'rt-task') => {
    const { data: task, error: taskError } = await m1.client
      .from('tasks')
      .insert({ object_id: objectId, title, assignee_id: assignee.id })
      .select('id')
      .single()
    if (taskError) throw taskError
    return task.id
  }
  return { m1, m2, e1, e2, objectId, createTask }
}
