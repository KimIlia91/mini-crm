/** Texts of the app shell and guard screens. Namespace: `layout`. */
export const layoutRu = {
  nav: {
    label: 'Основная навигация',
    group: 'Разделы',
    objects: 'Объекты',
    myTasks: 'Мои задачи',
  },
  crumbs: {
    objects: 'Объекты',
    myTasks: 'Мои задачи',
  },
  role: {
    manager: 'Постановщик',
    executor: 'Исполнитель',
  },
  profile: {
    menu: 'Меню пользователя: {{name}}',
    theme: 'Тема',
    about: 'О проекте',
    signOut: 'Выйти',
  },
  noAccess: {
    code: '403',
    title: 'Нет доступа',
    description: 'Для вашей учётной записи нет профиля в системе. Обратитесь к администратору.',
    failedTitle: 'Не удалось загрузить профиль',
    failedDescription: 'Проверьте соединение и повторите попытку.',
    retry: 'Повторить',
  },
} as const
