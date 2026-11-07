import { describe, expect, it } from 'vitest'

import { TASK_STATUS_ORDER, type TaskStatus } from './task-status'
import { getAvailableTransitions, type TransitionRule } from './transitions'

const rules: TransitionRule[] = [
  { from_status: 'new', to_status: 'in_progress', actor_role: 'executor', comment_required: false },
  {
    from_status: 'in_progress',
    to_status: 'in_review',
    actor_role: 'executor',
    comment_required: false,
  },
  {
    from_status: 'in_review',
    to_status: 'accepted',
    actor_role: 'manager',
    comment_required: false,
  },
  { from_status: 'in_review', to_status: 'rework', actor_role: 'manager', comment_required: true },
  {
    from_status: 'rework',
    to_status: 'in_progress',
    actor_role: 'executor',
    comment_required: false,
  },
]

const expected: Record<TaskStatus, { executorAssignee: TaskStatus[]; manager: TaskStatus[] }> = {
  new: { executorAssignee: ['in_progress'], manager: [] },
  in_progress: { executorAssignee: ['in_review'], manager: [] },
  in_review: { executorAssignee: [], manager: ['accepted', 'rework'] },
  accepted: { executorAssignee: [], manager: [] },
  rework: { executorAssignee: ['in_progress'], manager: [] },
}

interface Viewer {
  id: string
  role: 'manager' | 'executor'
}
const executor: Viewer = { id: 'exec-1', role: 'executor' }
const otherExecutor: Viewer = { id: 'exec-2', role: 'executor' }
const manager: Viewer = { id: 'mgr-1', role: 'manager' }

function targets(status: TaskStatus, viewer: Viewer) {
  return getAvailableTransitions(rules, { status, assignee_id: 'exec-1' }, viewer)
    .map((rule) => rule.to_status)
    .sort()
}

describe('getAvailableTransitions', () => {
  describe.each(TASK_STATUS_ORDER)('status %s', (status) => {
    it('assigned executor gets only executor transitions', () => {
      expect(targets(status, executor)).toEqual([...expected[status].executorAssignee].sort())
    })
    it('non-assigned executor gets nothing', () => {
      expect(targets(status, otherExecutor)).toEqual([])
    })
    it('manager gets only manager transitions', () => {
      expect(targets(status, manager)).toEqual([...expected[status].manager].sort())
    })
  })

  it('keeps the comment_required flag of the rule', () => {
    const result = getAvailableTransitions(
      rules,
      { status: 'in_review', assignee_id: 'exec-1' },
      manager,
    )
    expect(result.map((rule) => [rule.to_status, rule.comment_required])).toEqual([
      ['accepted', false],
      ['rework', true],
    ])
  })

  it('returns nothing when there are no rules', () => {
    expect(getAvailableTransitions([], { status: 'new', assignee_id: 'exec-1' }, executor)).toEqual(
      [],
    )
  })
})
