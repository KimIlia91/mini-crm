/** Texts of the app shell and guard screens. Namespace: `layout`. */
export const layoutRu = {
  nav: {
    label: 'Основная навигация',
    group: 'Разделы',
    objects: 'Объекты',
    myTasks: 'Мои задачи',
    board: 'Доска',
  },
  crumbs: {
    objects: 'Объекты',
    myTasks: 'Мои задачи',
    board: 'Доска',
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
  notifications: {
    title: 'Уведомления',
    bell: 'Уведомления',
    bellUnread: 'Уведомления, непрочитанных: {{unread}}',
    markAllRead: 'Прочитать все',
    showMore: 'Показать ещё',
    empty: 'Уведомлений пока нет',
    loadFailed: 'Не удалось загрузить уведомления',
    retry: 'Повторить',
    listLabel: 'Список уведомлений',
    markAllFailed: 'Не удалось отметить уведомления прочитанными. Попробуйте ещё раз',
    allRead: 'Все уведомления прочитаны',
    offline: 'Нет соединения — отметим, когда сеть появится',
    region: 'Уведомления',
    toastClose: 'Закрыть уведомление',
  },
  routeError: {
    documentTitle: 'Ошибка',
    title: 'Что-то пошло не так',
    description:
      'Страница не открылась из-за ошибки в приложении. Обновите страницу или вернитесь на главную.',
    reload: 'Обновить страницу',
    home: 'На главную',
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
