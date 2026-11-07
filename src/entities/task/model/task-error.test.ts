import { describe, expect, it } from 'vitest'

import { taskErrorKey } from './task-error'

describe('taskErrorKey', () => {
  it.each([
    [{ code: 'P0001', message: 'task_not_found' }, 'errors.notFound'],
    [{ code: 'P0001', message: 'object_not_found' }, 'errors.objectNotFound'],
    [{ code: 'P0001', message: 'transition_not_allowed' }, 'errors.transitionNotAllowed'],
    [{ code: 'P0001', message: 'comment_required' }, 'errors.commentRequired'],
    [{ code: 'P0001', message: 'assignee_not_executor' }, 'errors.assigneeNotExecutor'],
    [{ code: '23514', message: 'check violation' }, 'errors.invalidFields'],
    [{ code: 'PGRST116', message: 'no rows' }, 'errors.notEditable'],
    [{ code: '42501', message: 'denied' }, 'errors.forbidden'],
  ])('maps %j', (error, key) => {
    expect(taskErrorKey(error)).toBe(key)
  })

  it('falls back for unknown errors', () => {
    expect(taskErrorKey(new Error('boom'))).toBe('errors.generic')
    expect(taskErrorKey(null)).toBe('errors.generic')
  })
})
