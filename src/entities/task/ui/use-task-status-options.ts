import { useTranslation } from 'react-i18next'

import type { DataTableFilterOption } from '@/shared/ui'

import { TASK_STATUS_OPTIONS } from '../model/task-status'
import { TASK_STATUS_ICON } from './task-status-badge'

/** Status filter options (label + icon) in workflow order. */
export function useTaskStatusOptions(): DataTableFilterOption[] {
  const { t } = useTranslation('entity-task')
  return TASK_STATUS_OPTIONS.map((option) => ({
    value: option.value,
    label: t(option.labelKey),
    icon: TASK_STATUS_ICON[option.value],
  }))
}
