import type { Database } from '@/shared/api'

export type TaskStatus = Database['public']['Enums']['task_status']

/** Workflow order, used for grouping and sorting (tasks needing action first). */
export const TASK_STATUS_ORDER: readonly TaskStatus[] = [
  'rework',
  'new',
  'in_progress',
  'in_review',
  'accepted',
]

/** Statuses in workflow order with the `entity-task` key of their label (for filters). */
export const TASK_STATUS_OPTIONS = TASK_STATUS_ORDER.map((value) => ({
  value,
  labelKey: `status.${value}` as const,
}))

/** Comparator by workflow position; `Array.sort` is stable, so ties keep the incoming order. */
export function compareByStatusOrder(a: { status: TaskStatus }, b: { status: TaskStatus }): number {
  return TASK_STATUS_ORDER.indexOf(a.status) - TASK_STATUS_ORDER.indexOf(b.status)
}
