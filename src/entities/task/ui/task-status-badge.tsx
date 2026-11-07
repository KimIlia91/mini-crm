import { useTranslation } from 'react-i18next'
import {
  CircleCheckIcon,
  CircleDashedIcon,
  EyeIcon,
  RotateCcwIcon,
  TimerIcon,
  type LucideIcon,
} from 'lucide-react'

import { Badge } from '@/shared/ui'

import { cn } from '@/shared/lib'

import type { TaskStatus } from '../model/task-status'
import { TASK_STATUS_TONE } from './task-status-tone'

/** One icon per status; shared by the badge and the table status filter. */
export const TASK_STATUS_ICON: Record<TaskStatus, LucideIcon> = {
  new: CircleDashedIcon,
  in_progress: TimerIcon,
  in_review: EyeIcon,
  accepted: CircleCheckIcon,
  rework: RotateCcwIcon,
}

/** Status is always icon + text, never colour alone. */
export function TaskStatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const { t } = useTranslation('entity-task')
  const Icon = TASK_STATUS_ICON[status]
  const tone = TASK_STATUS_TONE[status]
  return (
    <Badge variant="outline" className={cn('text-foreground', tone.badge, className)}>
      <Icon aria-hidden="true" className={tone.icon} />
      {t(`status.${status}`)}
    </Badge>
  )
}
