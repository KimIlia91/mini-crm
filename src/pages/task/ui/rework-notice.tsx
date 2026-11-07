import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquareWarningIcon } from 'lucide-react'

import { taskQueries } from '@/entities/task'
import { formatDateTime, formatDateTimeFull } from '@/shared/lib'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui'

/**
 * The manager's latest remark on a task returned for rework, for both roles. Reads the history the
 * page already loads (same query key), so it adds no request; nothing is shown until it arrives.
 */
export function ReworkNotice({ taskId }: { taskId: string }) {
  const { t } = useTranslation('task')
  const titleId = useId()
  const history = useQuery(taskQueries.history(taskId))
  const remark = history.data?.findLast((entry) => entry.to_status === 'rework' && entry.comment)
  if (!remark?.comment) return null

  return (
    <Alert role="note" aria-labelledby={titleId} className="min-w-0 border-destructive/40">
      <MessageSquareWarningIcon aria-hidden="true" />
      <AlertTitle id={titleId} className="font-medium">
        {t('reworkNotice.title')}
      </AlertTitle>
      <AlertDescription className="min-w-0">
        <blockquote className="[overflow-wrap:anywhere] whitespace-pre-wrap text-foreground">
          {remark.comment}
        </blockquote>
        <p className="mt-1 [overflow-wrap:anywhere]">
          {remark.changed_by.full_name}
          {', '}
          <time dateTime={remark.changed_at} title={formatDateTimeFull(remark.changed_at)}>
            {formatDateTime(remark.changed_at)}
          </time>
        </p>
      </AlertDescription>
    </Alert>
  )
}
