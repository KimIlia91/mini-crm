/** Texts of the executor's task list. Namespace: `my-tasks`. */
export const myTasksRu = {
  title: 'Мои задачи',
  description: 'Задачи, назначенные вам. Сначала те, что требуют действий.',
  table: 'Мои задачи',
  search: 'Поиск по названию и объекту',
  columns: { title: 'Название', object: 'Объект', status: 'Статус', createdAt: 'Создана' },
  filters: { status: 'Статус' },
  empty: 'Вам пока не назначено задач',
  emptyHint: 'Новые задачи появятся здесь.',
  noResults: 'Ничего не найдено',
  noResultsHint: 'Измените запрос или сбросьте фильтры.',
  loadError: 'Не удалось загрузить задачи',
  retry: 'Повторить',
} as const
