/** Texts of the object dialogs. Namespace: `manage-object`. */
export const manageObjectRu = {
  form: {
    createTitle: 'Добавить объект',
    editTitle: 'Редактировать объект',
    description: 'Название и адрес объекта.',
    name: 'Название',
    address: 'Адрес',
    create: 'Создать',
    save: 'Сохранить',
  },
  delete: {
    trigger: 'Удалить',
    triggerLabel: 'Удалить объект «{{name}}»',
    title: 'Удалить объект?',
    description:
      'Объект «{{name}}» исчезнет из списков. Удалить можно только объект без активных задач.',
    confirm: 'Удалить',
  },
  validation: {
    nameRequired: 'Введите название',
    nameTooLong: 'Название не должно быть длиннее 200 символов',
    addressRequired: 'Введите адрес',
    addressTooLong: 'Адрес не должен быть длиннее 500 символов',
  },
  errors: {
    notAvailable: 'Объект не найден или уже удалён',
    hasTasks: 'Нельзя удалить объект, пока в нём есть активные задачи',
    invalidFields: 'Проверьте заполнение полей',
    forbidden: 'Недостаточно прав',
    generic: 'Не удалось выполнить действие. Попробуйте ещё раз',
  },
} as const
