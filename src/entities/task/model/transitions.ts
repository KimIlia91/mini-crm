import type { Database } from '@/shared/api'

import type { TaskStatus } from './task-status'

/** A row of public.task_transitions — the single source of truth for workflow rules. */
export type TransitionRule = Database['public']['Tables']['task_transitions']['Row']

interface TaskLike {
  status: TaskStatus
  assignee_id: string
}

interface ViewerLike {
  id: string
  role: Database['public']['Enums']['app_role']
}

/**
 * Transitions the viewer may trigger. UX only — the database enforces the same rules.
 * An executor may act only on a task assigned to them.
 */
export function getAvailableTransitions(
  rules: readonly TransitionRule[],
  task: TaskLike,
  viewer: ViewerLike,
): TransitionRule[] {
  if (viewer.role === 'executor' && task.assignee_id !== viewer.id) return []
  return rules.filter((rule) => rule.from_status === task.status && rule.actor_role === viewer.role)
}
