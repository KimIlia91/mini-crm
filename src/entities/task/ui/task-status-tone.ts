import type { TaskStatus } from '../model/task-status'

interface StatusTone {
  dot: string
  icon: string
  badge: string
}

/** The one place that maps a status to its colours; status is always shown with an icon and text too. */
export const TASK_STATUS_TONE: Record<TaskStatus, StatusTone> = {
  new: {
    dot: 'bg-slate-500 dark:bg-slate-400',
    icon: 'text-slate-600 dark:text-slate-300',
    badge: 'border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/60',
  },
  in_progress: {
    dot: 'bg-blue-600 dark:bg-blue-400',
    icon: 'text-blue-700 dark:text-blue-300',
    badge: 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/60',
  },
  in_review: {
    dot: 'bg-amber-500 dark:bg-amber-400',
    icon: 'text-amber-700 dark:text-amber-300',
    badge: 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/60',
  },
  accepted: {
    dot: 'bg-green-600 dark:bg-green-400',
    icon: 'text-green-700 dark:text-green-300',
    badge: 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/60',
  },
  rework: {
    dot: 'bg-red-600 dark:bg-red-400',
    icon: 'text-red-700 dark:text-red-300',
    badge: 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/60',
  },
}
