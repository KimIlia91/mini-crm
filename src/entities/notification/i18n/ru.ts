/** Texts of the notification entity. Namespace: `entity-notification`. */
export const entityNotificationRu = {
  item: {
    unread: 'Не прочитано',
  },
  /** What happened, by notification kind. */
  kind: {
    task_assigned: 'Назначена вам',
    task_unassigned: 'Передана другому исполнителю',
    task_deleted: 'Удалена',
    task_rework: 'Возвращена на доработку',
    task_accepted: 'Принята',
    task_in_progress: 'Взята в работу',
    task_in_review: 'Отправлена на проверку',
  },
  /** Outcome of a request that another manager already handled. */
  resolution: {
    accepted: 'Принята',
    acceptedBy: 'Принята: {{name}}',
    rework: 'Возвращена на доработку',
    reworkBy: 'Возвращена на доработку: {{name}}',
    deleted: 'Задача удалена',
  },
  errors: {
    markRead: 'Не удалось отметить уведомление прочитанным',
  },
  toast: {
    open: 'Открыть',
    openTask: 'задачу: {{title}}',
    summary: 'Новых уведомлений: {{total}} — откройте список под значком колокольчика',
  },
} as const
