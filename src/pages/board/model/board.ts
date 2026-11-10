import { z } from 'zod'

import type { AppRole } from '@/entities/profile'
import {
  getAvailableTransitions,
  type BoardTaskRow,
  type TaskStatus,
  type TransitionRule,
} from '@/entities/task'
import { MAX_PAGE_SIZE } from '@/shared/api'

/** Columns in workflow order: the final status is last. */
export const BOARD_STATUS_ORDER: readonly TaskStatus[] = [
  'new',
  'in_progress',
  'in_review',
  'rework',
  'accepted',
]

/** How many more cards «Show more» loads into a column. */
export const BOARD_COLUMN_STEP = 20

/** The next column limit: one step further, never above the page ceiling. */
export function nextColumnLimit(limit: number): number {
  return Math.min(limit + BOARD_COLUMN_STEP, MAX_PAGE_SIZE)
}

/** The most objects the board filter holds at once. */
export const MAX_BOARD_OBJECTS = 10

/** Valid, distinct object ids of the repeated `object` URL values, in URL order, at most `MAX_BOARD_OBJECTS`. */
export function parseObjectIds(values: readonly string[]): string[] {
  const valid = values.flatMap((value) => parseObjectFilter(value) ?? [])
  return [...new Set(valid)].slice(0, MAX_BOARD_OBJECTS)
}

/** A valid `object` URL value or `undefined` (absent or malformed). */
export function parseObjectFilter(value: string | null): string | undefined {
  if (value === null) return undefined
  const parsed = z.uuid().safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/** The active column of the single-column layout: the URL value, else the role's working column. */
export function pickBoardColumn(value: string | null, role: AppRole): TaskStatus {
  const requested = BOARD_STATUS_ORDER.find((status) => status === value)
  if (requested !== undefined) return requested
  return role === 'executor' ? 'in_progress' : 'in_review'
}

export type MoveTask = Pick<BoardTaskRow, 'id' | 'title' | 'status' | 'assignee_id'>

/** The rule that lets the viewer move the task into `to`; `undefined` = the move is not allowed. */
export function findTransition(
  rules: readonly TransitionRule[],
  task: Pick<BoardTaskRow, 'status' | 'assignee_id'>,
  viewer: { id: string; role: AppRole },
  to: TaskStatus,
): TransitionRule | undefined {
  return getAvailableTransitions(rules, task, viewer).find((rule) => rule.to_status === to)
}
