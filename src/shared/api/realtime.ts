import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js'
import { z } from 'zod'

import { getSupabaseClient } from './supabase-client'

const idSchema = z.uuid()

/** Ids per notification hint: the database sends them in chunks of this size. */
const NOTIFICATION_IDS_MAX = 200

// Messages are hints only: Zod strips unknown keys (realtime.send adds an extra `id`),
// and nothing from a message is ever written to the query cache.
const taskHintSchema = z.object({ id: idSchema, object_id: idSchema })
const objectHintSchema = z.object({ id: idSchema })
const notificationHintSchema = z.object({
  op: z.enum(['created', 'updated']),
  // Per-user events may list the ids; manager-wide ones (on `role:manager`) carry none.
  ids: z.array(idSchema).max(NOTIFICATION_IDS_MAX).optional(),
})

export type RealtimeHint =
  | { kind: 'task'; id: string; objectId: string }
  | { kind: 'object'; id: string }
  | { kind: 'notification'; op: 'created' | 'updated'; ids?: string[] }

export type RealtimeStatus = 'subscribed' | 'closed' | 'error'

export const MANAGER_TOPIC = 'role:manager'

export function userTopic(userId: string): string {
  return `user:${userId}`
}

/** Pure parser of one broadcast event; `undefined` for an unknown event or a malformed payload. */
export function parseHint(event: string, payload: unknown): RealtimeHint | undefined {
  switch (event) {
    case 'task': {
      const parsed = taskHintSchema.safeParse(payload)
      return parsed.success
        ? { kind: 'task', id: parsed.data.id, objectId: parsed.data.object_id }
        : undefined
    }
    case 'object': {
      const parsed = objectHintSchema.safeParse(payload)
      return parsed.success ? { kind: 'object', id: parsed.data.id } : undefined
    }
    case 'notification': {
      const parsed = notificationHintSchema.safeParse(payload)
      return parsed.success ? { kind: 'notification', ...parsed.data } : undefined
    }
    default:
      return undefined
  }
}

const HINT_EVENTS = ['task', 'object', 'notification'] as const

/**
 * Subscribes to private broadcast channels (authorised by RLS on realtime.messages) and reports
 * parsed hints and connection status. Returns the cleanup function.
 *
 * The channels are created on the next macrotask: the cleanup of a React Strict Mode probe mount
 * cancels them before they exist, so a topic is never joined twice or re-used while it is leaving.
 */
export function subscribeToHints(
  topics: readonly string[],
  onHint: (hint: RealtimeHint) => void,
  onStatus: (status: RealtimeStatus) => void,
): () => void {
  const client = getSupabaseClient()
  const opened: ReturnType<typeof client.channel>[] = []
  let cancelled = false

  const timer = setTimeout(() => {
    for (const topic of topics) {
      const channel = client.channel(topic, { config: { private: true } })
      for (const event of HINT_EVENTS) {
        channel.on('broadcast', { event }, ({ payload }: { payload: unknown }) => {
          if (cancelled) return
          const hint = parseHint(event, payload)
          if (hint) onHint(hint)
        })
      }
      channel.subscribe((status) => {
        if (cancelled) return
        if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) onStatus('subscribed')
        else if (status === REALTIME_SUBSCRIBE_STATES.CLOSED) onStatus('closed')
        else onStatus('error')
      })
      opened.push(channel)
    }
  }, 0)

  return () => {
    cancelled = true
    clearTimeout(timer)
    for (const channel of opened) void client.removeChannel(channel)
  }
}
