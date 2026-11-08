import { describe, expect, it } from 'vitest'

import { notificationKeys } from '@/entities/notification'
import { objectKeys } from '@/entities/object'
import { taskKeys } from '@/entities/task'

import { keysForHint } from './hint-keys'

describe('keysForHint', () => {
  it('task: its detail and history, every task list, the object and object lists', () => {
    expect(keysForHint({ kind: 'task', id: 't1', objectId: 'o1' })).toEqual([
      taskKeys.detail('t1'),
      taskKeys.history('t1'),
      taskKeys.lists(),
      objectKeys.detail('o1'),
      objectKeys.lists(),
    ])
  })

  it('object: its detail, object lists and task lists', () => {
    expect(keysForHint({ kind: 'object', id: 'o1' })).toEqual([
      objectKeys.detail('o1'),
      objectKeys.lists(),
      taskKeys.lists(),
    ])
  })

  it('notification: everything under the notification root', () => {
    expect(keysForHint({ kind: 'notification', op: 'updated', ids: ['n1'] })).toEqual([
      notificationKeys.all,
    ])
  })

  it('list keys are prefixes of the concrete list keys they must refresh', () => {
    const [, , lists] = keysForHint({ kind: 'task', id: 't1', objectId: 'o1' })
    const params = {
      pageIndex: 0,
      pageSize: 10,
      search: '',
      sort: { id: 'status', desc: false },
      statuses: [],
    } as const
    expect(taskKeys.byObject('o1', params).slice(0, 2)).toEqual(lists)
    expect(taskKeys.mine('u1', params).slice(0, 2)).toEqual(lists)
  })
})
