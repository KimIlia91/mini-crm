import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import {
  notificationLink,
  useMarkNotificationsRead,
  type AppNotification,
} from '@/entities/notification'
import { taskKeys } from '@/entities/task'
import { toast } from '@/shared/ui'

/** An error toast stays long enough to be read. */
export const ERROR_TOAST_MS = 8000

/**
 * Opens a notification (list item or toast action): marks it read and, when its task can still be
 * opened, goes there. The task's cached detail is invalidated first: a hint may have been missed, and
 * a cached «not found» from before the task was assigned to the viewer would otherwise be shown
 * for up to the stale time. A failed mark-read is reported with an error toast; navigation still
 * happens. Returns the path navigated to, or `null` when there is none.
 */
export function useOpenNotification() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const markRead = useMarkNotificationsRead()
  const { t } = useTranslation('entity-notification')
  return (notification: AppNotification): string | null => {
    if (!notification.read) {
      markRead.mutate([notification.id], {
        onError: () => {
          toast.error(t('errors.markRead'), { duration: ERROR_TOAST_MS })
        },
      })
    }
    const link = notificationLink(notification)
    if (link === null) return null
    void queryClient.invalidateQueries({ queryKey: taskKeys.detail(notification.taskId) })
    void queryClient.invalidateQueries({ queryKey: taskKeys.history(notification.taskId) })
    void navigate(link)
    return link
  }
}
