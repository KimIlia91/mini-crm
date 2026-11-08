import { useTranslation } from 'react-i18next'

import type { AppNotification } from './notification'

/** Localised parts of a notification for lists and toasts. */
export function useNotificationText() {
  const { t } = useTranslation('entity-notification')
  const kindText: Record<AppNotification['kind'], string> = {
    task_assigned: t('kind.task_assigned'),
    task_unassigned: t('kind.task_unassigned'),
    task_deleted: t('kind.task_deleted'),
    task_rework: t('kind.task_rework'),
    task_accepted: t('kind.task_accepted'),
    task_in_progress: t('kind.task_in_progress'),
    task_in_review: t('kind.task_in_review'),
  }
  return {
    event: (n: Pick<AppNotification, 'kind'>): string => kindText[n.kind],
    describe: (n: Pick<AppNotification, 'kind' | 'comment'>): string => {
      const text = kindText[n.kind]
      return n.comment ? `${text}: ${n.comment}` : text
    },
    resolve: (n: Pick<AppNotification, 'resolution' | 'resolvedByName'>): string | undefined => {
      const name = n.resolvedByName
      switch (n.resolution) {
        case 'accepted':
          return name ? t('resolution.acceptedBy', { name }) : t('resolution.accepted')
        case 'rework':
          return name ? t('resolution.reworkBy', { name }) : t('resolution.rework')
        case 'deleted':
          return t('resolution.deleted')
        case null:
          return undefined
      }
    },
  }
}
