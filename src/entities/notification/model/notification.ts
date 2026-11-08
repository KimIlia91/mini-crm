import type { Database } from '@/shared/api'

export type NotificationKind = Database['public']['Enums']['notification_kind']
export type NotificationResolution = 'accepted' | 'rework' | 'deleted'

/** A notification of the signed-in user, as the UI reads it (display data only). */
export interface AppNotification {
  id: string
  kind: NotificationKind
  taskId: string
  title: string
  comment: string | null
  actorName: string | null
  createdAt: string
  read: boolean
  resolution: NotificationResolution | null
  resolvedByName: string | null
}

export interface NotificationPage {
  items: AppNotification[]
  total: number
}

/** The list grows by one page up to the maximum. */
export const NOTIFICATION_PAGE_SIZE = 20
export const NOTIFICATION_MAX_LIMIT = 200

const MAX_BADGE = 99

/** Unread counter for the bell: «99+» above the cap. */
export function formatUnreadCount(count: number): string {
  return count > MAX_BADGE ? `${String(MAX_BADGE)}+` : String(count)
}

export function parseResolution(value: string | null): NotificationResolution | null {
  return value === 'accepted' || value === 'rework' || value === 'deleted' ? value : null
}

/** Path of the related task, or `null` when the user can no longer open it (unassigned/deleted). */
export function notificationLink(
  notification: Pick<AppNotification, 'kind' | 'taskId' | 'resolution'>,
): string | null {
  if (
    notification.kind === 'task_unassigned' ||
    notification.kind === 'task_deleted' ||
    notification.resolution === 'deleted'
  ) {
    return null
  }
  return `/tasks/${notification.taskId}`
}

/** Next list limit, or `null` when everything is loaded or the maximum is reached. */
export function nextNotificationLimit(limit: number, total: number): number | null {
  if (limit >= NOTIFICATION_MAX_LIMIT || limit >= total) return null
  return Math.min(limit + NOTIFICATION_PAGE_SIZE, NOTIFICATION_MAX_LIMIT)
}
