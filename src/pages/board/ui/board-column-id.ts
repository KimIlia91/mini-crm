import type { TaskStatus } from '@/entities/task'

/** Id of a column heading; focus lands on it after a card leaves a column. */
export function boardColumnHeadingId(status: TaskStatus) {
  return `board-column-${status}`
}
