import { cn } from 'cn'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { TASK_STATUS_ICON, TASK_STATUS_TONE, type TaskStatus } from '@/entities/task'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui'

interface BoardColumnSwitchProps {
  value: TaskStatus
  statuses: readonly TaskStatus[]
  totals: Partial<Record<TaskStatus, number>>
  onChange: (status: TaskStatus) => void
  children: ReactNode
}

/** Below sm (640 px): one column at a time; all statuses stay visible as wrapping tabs with counts. */
export function BoardColumnSwitch({
  value,
  statuses,
  totals,
  onChange,
  children,
}: BoardColumnSwitchProps) {
  const { t } = useTranslation('board')
  const { t: tTask } = useTranslation('entity-task')

  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        const status = statuses.find((item) => item === next)
        if (status) onChange(status)
      }}
    >
      <TabsList
        aria-label={t('tabs')}
        className="h-auto w-full flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto"
      >
        {statuses.map((status) => {
          const Icon = TASK_STATUS_ICON[status]
          return (
            <TabsTrigger
              key={status}
              value={status}
              className="h-11 flex-none px-3 text-foreground group-data-horizontal/tabs:h-11"
            >
              <Icon aria-hidden="true" className={cn(TASK_STATUS_TONE[status].icon)} />
              {tTask(`status.${status}`)}
              {totals[status] === undefined ? null : (
                <span className="font-normal tabular-nums">{totals[status]}</span>
              )}
            </TabsTrigger>
          )
        })}
      </TabsList>
      <TabsContent
        value={value}
        className="rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {children}
      </TabsContent>
    </Tabs>
  )
}
