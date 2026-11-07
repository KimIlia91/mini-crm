import { describe, expect, it } from 'vitest'

import {
  DEFAULT_TASK_SORT,
  pickMyTaskSort,
  pickObjectTaskSort,
  pickStatuses,
  taskOrder,
} from './task-list'

describe('taskOrder', () => {
  it('status sort: status_rank in the sort direction, then created_at desc, then id desc', () => {
    expect(taskOrder({ id: 'status', desc: false }, {})).toEqual([
      { column: 'status_rank', ascending: true },
      { column: 'created_at', ascending: false },
      { column: 'id', ascending: false },
    ])
  })

  it('status sort desc flips only the rank; the tie-breakers stay newest first', () => {
    expect(taskOrder({ id: 'status', desc: true }, {})).toEqual([
      { column: 'status_rank', ascending: false },
      { column: 'created_at', ascending: false },
      { column: 'id', ascending: false },
    ])
  })

  it('plain column: the column then id in the same direction', () => {
    expect(taskOrder({ id: 'title', desc: false }, {})).toEqual([
      { column: 'title', ascending: true },
      { column: 'id', ascending: true },
    ])
    expect(taskOrder({ id: 'created_at', desc: true }, {})).toEqual([
      { column: 'created_at', ascending: false },
      { column: 'id', ascending: false },
    ])
  })

  it('related column goes through the mapping, id follows the direction', () => {
    expect(taskOrder({ id: 'assignee', desc: false }, { assignee: 'assignee(full_name)' })).toEqual(
      [
        { column: 'assignee(full_name)', ascending: true },
        { column: 'id', ascending: true },
      ],
    )
    expect(taskOrder({ id: 'object', desc: true }, { object: 'object(name)' })).toEqual([
      { column: 'object(name)', ascending: false },
      { column: 'id', ascending: false },
    ])
  })

  it('a column absent from the mapping is used as is', () => {
    expect(taskOrder({ id: 'title', desc: false }, { object: 'object(name)' })[0]).toEqual({
      column: 'title',
      ascending: true,
    })
  })
})

describe('pickObjectTaskSort / pickMyTaskSort', () => {
  it('keeps allowed ids with their direction', () => {
    expect(pickObjectTaskSort({ id: 'assignee', desc: true })).toEqual({
      id: 'assignee',
      desc: true,
    })
    expect(pickMyTaskSort({ id: 'object', desc: false })).toEqual({ id: 'object', desc: false })
    expect(pickMyTaskSort({ id: 'created_at', desc: true })).toEqual({
      id: 'created_at',
      desc: true,
    })
  })

  it('falls back to the default for unknown ids, ids of the other list and undefined', () => {
    expect(pickObjectTaskSort({ id: 'password', desc: true })).toEqual(DEFAULT_TASK_SORT)
    expect(pickObjectTaskSort({ id: 'object', desc: true })).toEqual(DEFAULT_TASK_SORT)
    expect(pickMyTaskSort({ id: 'assignee', desc: true })).toEqual(DEFAULT_TASK_SORT)
    expect(pickMyTaskSort({ id: '', desc: false })).toEqual(DEFAULT_TASK_SORT)
    expect(pickMyTaskSort(undefined)).toEqual(DEFAULT_TASK_SORT)
    expect(DEFAULT_TASK_SORT).toEqual({ id: 'status', desc: false })
  })
})

describe('pickStatuses', () => {
  it('drops unknown values and returns known ones in workflow order', () => {
    expect(pickStatuses(['accepted', 'bogus', 'new', 'rework', ''])).toEqual([
      'rework',
      'new',
      'accepted',
    ])
  })

  it('removes duplicates and handles an empty list', () => {
    expect(pickStatuses(['new', 'new'])).toEqual(['new'])
    expect(pickStatuses([])).toEqual([])
  })

  it('is case-sensitive: wrong-case values are dropped', () => {
    expect(pickStatuses(['NEW', 'In_Progress'])).toEqual([])
  })
})
