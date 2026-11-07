/** Texts of the task form and delete dialog. Namespace: `manage-task`. */
export const manageTaskRu = {
  form: {
    createTrigger: 'Добавить задачу',
    editTrigger: 'Редактировать',
    createTitle: 'Новая задача',
    editTitle: 'Редактирование задачи',
    createDescription: 'Задача появится со статусом «Новая».',
    editDescription: 'Объект задачи изменить нельзя.',
    title: 'Название',
    description: 'Описание',
    assignee: 'Исполнитель',
    assigneePlaceholder: 'Выберите исполнителя',
    noExecutors: 'Нет доступных исполнителей',
    executorsError: 'Не удалось загрузить исполнителей',
    retry: 'Повторить',
    create: 'Создать',
    save: 'Сохранить',
  },
  delete: {
    trigger: 'Удалить',
    title: 'Удалить задачу?',
    description: 'Задача исчезнет из списков. История изменений сохранится.',
    confirm: 'Удалить',
  },
  validation: {
    titleRequired: 'Введите название',
    titleTooLong: 'Не более 200 символов',
    descriptionTooLong: 'Не более 5000 символов',
    assigneeRequired: 'Выберите исполнителя',
  },
} as const
