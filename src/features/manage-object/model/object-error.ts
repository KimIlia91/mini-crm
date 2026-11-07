import type { manageObjectRu } from '../i18n/ru'

/** A write matched no rows: the object is gone or RLS hides it from the viewer. */
export class ObjectNotAvailableError extends Error {
  constructor() {
    super('object_not_available')
    this.name = 'ObjectNotAvailableError'
  }
}

export type ObjectErrorKey = `errors.${keyof typeof manageObjectRu.errors}`

function getCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

function getMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error
    return typeof message === 'string' ? message : ''
  }
  return ''
}

/** `manage-object` translation key for a Supabase/Postgres error of an object operation. */
export function objectErrorKey(error: unknown): ObjectErrorKey {
  if (error instanceof ObjectNotAvailableError) return 'errors.notAvailable'
  const message = getMessage(error)
  if (message.includes('object_has_tasks')) return 'errors.hasTasks'
  if (message.includes('object_not_found')) return 'errors.notAvailable'
  switch (getCode(error)) {
    case '23514':
      return 'errors.invalidFields'
    case '42501':
      return 'errors.forbidden'
    default:
      return 'errors.generic'
  }
}
