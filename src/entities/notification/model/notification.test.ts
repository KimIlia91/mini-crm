import { describe, expect, it } from 'vitest'

import {
  formatUnreadCount,
  nextNotificationLimit,
  notificationLink,
  parseResolution,
} from './notification'

describe('formatUnreadCount', () => {
  it('shows the number up to 99 and 99+ above', () => {
    expect(formatUnreadCount(0)).toBe('0')
    expect(formatUnreadCount(99)).toBe('99')
    expect(formatUnreadCount(100)).toBe('99+')
    expect(formatUnreadCount(5000)).toBe('99+')
  })
})

describe('notificationLink', () => {
  const base = { taskId: 't1', resolution: null } as const
  it('links to the task for kinds whose task the user can open', () => {
    expect(notificationLink({ ...base, kind: 'task_assigned' })).toBe('/tasks/t1')
    expect(notificationLink({ ...base, kind: 'task_in_review' })).toBe('/tasks/t1')
    expect(notificationLink({ ...base, kind: 'task_in_review', resolution: 'accepted' })).toBe(
      '/tasks/t1',
    )
  })
  it('has no link when the task is gone or no longer the user’s', () => {
    expect(notificationLink({ ...base, kind: 'task_deleted' })).toBeNull()
    expect(notificationLink({ ...base, kind: 'task_unassigned' })).toBeNull()
    expect(notificationLink({ ...base, kind: 'task_in_review', resolution: 'deleted' })).toBeNull()
  })
})

describe('nextNotificationLimit', () => {
  it('grows by a page while more exist, up to 200', () => {
    expect(nextNotificationLimit(20, 25)).toBe(40)
    expect(nextNotificationLimit(180, 500)).toBe(200)
  })
  it('stops when everything is loaded or the maximum is reached', () => {
    expect(nextNotificationLimit(20, 20)).toBeNull()
    expect(nextNotificationLimit(40, 30)).toBeNull()
    expect(nextNotificationLimit(200, 500)).toBeNull()
  })
})

describe('parseResolution', () => {
  it('accepts known values only', () => {
    expect(parseResolution('accepted')).toBe('accepted')
    expect(parseResolution('x')).toBeNull()
    expect(parseResolution(null)).toBeNull()
  })
})
