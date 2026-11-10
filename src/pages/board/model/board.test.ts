import { describe, expect, it } from 'vitest'

import type { TaskStatus, TransitionRule } from '@/entities/task'
import { MAX_PAGE_SIZE } from '@/shared/api'

import {
  BOARD_COLUMN_STEP,
  BOARD_STATUS_ORDER,
  findTransition,
  nextColumnLimit,
  parseObjectFilter,
  pickBoardColumn,
} from './board'

const RULES: TransitionRule[] = [
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

const EXECUTOR = { id: 'exec-1', role: 'executor' } as const
const MANAGER = { id: 'mgr-1', role: 'manager' } as const
const ALL: TaskStatus[] = ['new', 'in_progress', 'in_review', 'rework', 'accepted']

describe('BOARD_STATUS_ORDER', () => {
  it('lists the five statuses in workflow order with the final one last', () => {
    expect([...BOARD_STATUS_ORDER]).toEqual(ALL)
  })
})

describe('parseObjectFilter', () => {
  it('accepts a uuid', () => {
    const id = crypto.randomUUID()
    expect(parseObjectFilter(id)).toBe(id)
  })

  it.each([null, '', ' ', 'abc', '123', 'not-a-uuid', "' or 1=1 --", '<script>', 'a'.repeat(500)])(
    'treats %j as no filter',
    (value) => {
      expect(parseObjectFilter(value) ?? null).toBeNull()
    },
  )

  it('rejects a uuid with surrounding spaces or extra characters', () => {
    const id = crypto.randomUUID()
    expect(parseObjectFilter(` ${id}`) ?? null).toBeNull()
    expect(parseObjectFilter(`${id}x`) ?? null).toBeNull()
  })
})

describe('pickBoardColumn', () => {
  it.each(ALL)('keeps the valid column %s for both roles', (status) => {
    expect(pickBoardColumn(status, 'executor')).toBe(status)
    expect(pickBoardColumn(status, 'manager')).toBe(status)
  })

  it.each([null, '', 'unknown', 'IN_REVIEW', '__proto__', 'in_review '])(
    'falls back to the role default for %j',
    (value) => {
      expect(pickBoardColumn(value, 'executor')).toBe('in_progress')
      expect(pickBoardColumn(value, 'manager')).toBe('in_review')
    },
  )
})

describe('nextColumnLimit', () => {
  it('grows by one step', () => {
    expect(nextColumnLimit(BOARD_COLUMN_STEP)).toBe(BOARD_COLUMN_STEP * 2)
    expect(nextColumnLimit(40)).toBe(60)
  })

  it('never exceeds the page ceiling', () => {
    expect(nextColumnLimit(MAX_PAGE_SIZE)).toBe(MAX_PAGE_SIZE)
    expect(nextColumnLimit(MAX_PAGE_SIZE - 1)).toBe(MAX_PAGE_SIZE)
    expect(nextColumnLimit(90)).toBe(MAX_PAGE_SIZE)
  })
})

describe('findTransition', () => {
  const own = (status: TaskStatus) => ({ status, assignee_id: EXECUTOR.id })
  const foreign = (status: TaskStatus) => ({ status, assignee_id: 'someone-else' })

  function allowedColumns(
    task: { status: TaskStatus; assignee_id: string },
    viewer: { id: string; role: 'manager' | 'executor' },
  ) {
    return ALL.filter((to) => findTransition(RULES, task, viewer, to) !== undefined)
  }

  it.each<[TaskStatus, TaskStatus[]]>([
    ['new', ['in_progress']],
    ['in_progress', ['in_review']],
    ['in_review', []],
    ['rework', ['in_progress']],
    ['accepted', []],
  ])('executor with own task in %s may move to %j', (status, expected) => {
    expect(allowedColumns(own(status), EXECUTOR)).toEqual(expected)
  })

  it.each<[TaskStatus, TaskStatus[]]>([
    ['new', []],
    ['in_progress', []],
    ['in_review', ['rework', 'accepted']],
    ['rework', []],
    ['accepted', []],
  ])('manager with a task in %s may move to %j', (status, expected) => {
    expect(allowedColumns(foreign(status), MANAGER)).toEqual(expected)
  })

  it.each(ALL)('executor cannot move a foreign task in %s anywhere', (status) => {
    expect(allowedColumns(foreign(status), EXECUTOR)).toEqual([])
  })

  it.each(ALL)('the own column %s is never a target', (status) => {
    expect(findTransition(RULES, own(status), EXECUTOR, status)).toBeUndefined()
    expect(findTransition(RULES, foreign(status), MANAGER, status)).toBeUndefined()
  })

  it('returns the rule with comment_required for rework only', () => {
    expect(findTransition(RULES, foreign('in_review'), MANAGER, 'rework')?.comment_required).toBe(
      true,
    )
    expect(findTransition(RULES, foreign('in_review'), MANAGER, 'accepted')?.comment_required).toBe(
      false,
    )
  })

  it('allows nothing without rules', () => {
    expect(findTransition([], own('new'), EXECUTOR, 'in_progress')).toBeUndefined()
  })
})
