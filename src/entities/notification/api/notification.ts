import { keepPreviousData, queryOptions } from '@tanstack/react-query'

import { getSupabaseClient } from '@/shared/api'

import {
  parseResolution,
  type AppNotification,
  type NotificationKind,
  type NotificationPage,
} from '../model/notification'

export const notificationKeys = {
  all: ['notifications'] as const,
  list: (limit: number) => [...notificationKeys.all, 'list', limit] as const,
  unreadCount: () => [...notificationKeys.all, 'unread-count'] as const,
  unreadSince: (since: string) => [...notificationKeys.all, 'unread-since', since] as const,
  latest: () => [...notificationKeys.all, 'latest'] as const,
}

const UNREAD_SINCE_LIMIT = 50

const COLUMNS = `id, kind, task_id, title_snapshot, comment, created_at, read_at, resolution,
  actor:profiles!notifications_actor_id_fkey(full_name),
  resolver:profiles!notifications_resolved_by_fkey(full_name)`

interface NotificationRow {
  id: string
  kind: NotificationKind
  task_id: string
  title_snapshot: string
  comment: string | null
  created_at: string
  read_at: string | null
  resolution: string | null
  actor: { full_name: string } | null
  resolver: { full_name: string } | null
}

function toAppNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    kind: row.kind,
    taskId: row.task_id,
    title: row.title_snapshot,
    comment: row.comment,
    actorName: row.actor?.full_name ?? null,
    createdAt: row.created_at,
    read: row.read_at !== null,
    resolution: parseResolution(row.resolution),
    resolvedByName: row.resolver?.full_name ?? null,
  }
}

export const notificationQueries = {
  /** Newest first; RLS returns only the viewer's own notifications. */
  list: (limit: number) =>
    queryOptions({
      queryKey: notificationKeys.list(limit),
      placeholderData: keepPreviousData,
      queryFn: async ({ signal }): Promise<NotificationPage> => {
        const { data, error, count } = await getSupabaseClient()
          .from('notifications')
          .select(COLUMNS, { count: 'exact' })
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(limit)
          .abortSignal(signal)
          .overrideTypes<NotificationRow[], { merge: false }>()
        if (error) throw error
        return { items: data.map(toAppNotification), total: count ?? data.length }
      },
    }),
  unreadCount: () =>
    queryOptions({
      queryKey: notificationKeys.unreadCount(),
      queryFn: async ({ signal }): Promise<number> => {
        const { count, error } = await getSupabaseClient()
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .is('read_at', null)
          .abortSignal(signal)
        if (error) throw error
        return count ?? 0
      },
    }),
  /** Creation time of the newest notification (where the toast cursor starts), or null when there is none. */
  latestCreatedAt: () =>
    queryOptions({
      queryKey: notificationKeys.latest(),
      queryFn: async ({ signal }): Promise<string | null> => {
        const { data, error } = await getSupabaseClient()
          .from('notifications')
          .select('created_at')
          .order('created_at', { ascending: false })
          .limit(1)
          .abortSignal(signal)
          .maybeSingle()
        if (error) throw error
        return data?.created_at ?? null
      },
    }),
  /** Newest unread notifications created after `since` (RLS: only the viewer's own). */
  unreadSince: (since: string) =>
    queryOptions({
      queryKey: notificationKeys.unreadSince(since),
      queryFn: async ({ signal }): Promise<AppNotification[]> => {
        const { data, error } = await getSupabaseClient()
          .from('notifications')
          .select(COLUMNS)
          .is('read_at', null)
          .gt('created_at', since)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(UNREAD_SINCE_LIMIT)
          .abortSignal(signal)
          .overrideTypes<NotificationRow[], { merge: false }>()
        if (error) throw error
        return data.map(toAppNotification)
      },
    }),
}
