import { useTranslation } from 'react-i18next'

import type { entityTaskRu } from '../i18n/ru'

export type TaskErrorKey = `errors.${keyof typeof entityTaskRu.errors}`

function read(error: unknown, key: 'code' | 'message'): string {
  if (typeof error === 'object' && error !== null && key in error) {
    const value = (error as Record<string, unknown>)[key]
    if (typeof value === 'string') return value
  }
  return ''
}

/** `entity-task` translation key for a Supabase/Postgres error of a task operation. */
export function taskErrorKey(error: unknown): TaskErrorKey {
  const code = read(error, 'code')
  const message = read(error, 'message')

  if (message.includes('task_not_found')) return 'errors.notFound'
  if (message.includes('object_not_found')) return 'errors.objectNotFound'
  if (message.includes('transition_not_allowed')) return 'errors.transitionNotAllowed'
  if (message.includes('comment_required')) return 'errors.commentRequired'
  if (message.includes('assignee_not_executor')) return 'errors.assigneeNotExecutor'
  if (code === '23514') return 'errors.invalidFields'
  if (code === 'PGRST116') return 'errors.notEditable'
  if (code === '42501') return 'errors.forbidden'
  return 'errors.generic'
}

/** User-facing text of a task operation error in the current language. */
export function useTaskErrorMessage(): (error: unknown) => string {
  const { t } = useTranslation('entity-task')
  return (error) => t(taskErrorKey(error))
}
