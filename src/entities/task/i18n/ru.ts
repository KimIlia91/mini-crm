/** Texts of the task entity (statuses, transition buttons, operation errors). Namespace: `entity-task`. */
export const entityTaskRu = {
  status: {
    new: 'Новая',
    in_progress: 'В работе',
    in_review: 'На проверке',
    accepted: 'Принята',
    rework: 'На доработке',
  },
  /** Button labels for moving a task INTO the given status. */
  transition: {
    new: 'Вернуть в новые',
    in_progress: 'Взять в работу',
    in_review: 'Отправить на проверку',
    accepted: 'Принять',
    rework: 'Вернуть на доработку',
  },
  errors: {
    notFound: 'Задача не найдена или недоступна',
    objectNotFound: 'Объект не найден или уже удалён',
    transitionNotAllowed: 'Действие недоступно: статус задачи изменился',
    commentRequired: 'Укажите комментарий',
    assigneeNotExecutor: 'Исполнителем может быть только исполнитель',
    invalidFields: 'Проверьте заполнение полей',
    notEditable: 'Задача недоступна для редактирования',
    forbidden: 'Недостаточно прав',
    generic: 'Не удалось выполнить операцию. Попробуйте ещё раз',
  },
} as const
