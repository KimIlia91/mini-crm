import { describe, expect, it } from 'vitest'

import { compareByStatusOrder, TASK_STATUS_OPTIONS, type TaskStatus } from './task-status'

describe('task status order', () => {
  it('lists tasks needing action first: rework before new, accepted last', () => {
    expect(TASK_STATUS_OPTIONS.map((option) => option.value)).toEqual([
      'rework',
      'new',
      'in_progress',
      'in_review',
      'accepted',
    ])
  })

  it('sorts by workflow position and keeps the incoming order for equal statuses', () => {
    const tasks: { id: number; status: TaskStatus }[] = [
      { id: 1, status: 'accepted' },
      { id: 2, status: 'new' },
      { id: 3, status: 'rework' },
      { id: 4, status: 'new' },
    ]
    expect(tasks.toSorted(compareByStatusOrder).map((task) => task.id)).toEqual([3, 2, 4, 1])
  })
})
