import type { ListSort, PageWindow } from '@/shared/api'

import { TASK_STATUS_ORDER, type TaskStatus } from './task-status'

/** Sort ids of the task lists — the only source of the allowed `sort` values per list. */
export const OBJECT_TASK_SORT_IDS = ['title', 'assignee', 'status', 'created_at'] as const
export const MY_TASK_SORT_IDS = ['title', 'object', 'status', 'created_at'] as const
export type ObjectTaskSortId = (typeof OBJECT_TASK_SORT_IDS)[number]
export type MyTaskSortId = (typeof MY_TASK_SORT_IDS)[number]

/** Workflow order (rework first), then newest first. */
export const DEFAULT_TASK_SORT = { id: 'status', desc: false } as const

export interface TaskListParams<SortId extends string> extends PageWindow {
  search: string
  sort: ListSort<SortId>
  statuses: readonly TaskStatus[]
}
export type ObjectTaskListParams = TaskListParams<ObjectTaskSortId>
export type MyTaskListParams = TaskListParams<MyTaskSortId>

/** Narrows a sort coming from the URL to an allowlist; anything else is the default. */
function pickSort<Id extends string>(
  ids: readonly Id[],
  sort: ListSort | undefined,
): ListSort<Id | typeof DEFAULT_TASK_SORT.id> {
  const id = ids.find((candidate) => candidate === sort?.id)
  return id === undefined || sort === undefined ? DEFAULT_TASK_SORT : { id, desc: sort.desc }
}

export const pickObjectTaskSort = (sort: ListSort | undefined) =>
  pickSort(OBJECT_TASK_SORT_IDS, sort)
export const pickMyTaskSort = (sort: ListSort | undefined) => pickSort(MY_TASK_SORT_IDS, sort)

/** Status values of the URL narrowed to the known statuses (no casts). */
export function pickStatuses(values: readonly string[]): TaskStatus[] {
  return TASK_STATUS_ORDER.filter((status) => values.includes(status))
}

interface OrderKey {
  column: string
  ascending: boolean
}

/**
 * `ORDER BY` keys for a sort: the sorted column (status → generated `status_rank`; related names
 * through the embed), then a stable tie-breaker — `id` in the same direction; a status sort is
 * followed by `created_at desc`.
 */
export function taskOrder(sort: ListSort, columns: Readonly<Record<string, string>>): OrderKey[] {
  const ascending = !sort.desc
  if (sort.id === 'status') {
    return [
      { column: 'status_rank', ascending },
      { column: 'created_at', ascending: false },
      { column: 'id', ascending: false },
    ]
  }
  return [
    { column: columns[sort.id] ?? sort.id, ascending },
    { column: 'id', ascending },
  ]
}

export interface ObjectTaskRow {
  id: string
  title: string
  status: TaskStatus
  created_at: string
  assignee: { id: string; full_name: string }
}

export interface MyTaskRow {
  id: string
  title: string
  status: TaskStatus
  created_at: string
  object: { id: string; name: string }
}
