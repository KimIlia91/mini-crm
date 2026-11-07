import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowRightIcon } from 'lucide-react'

import { taskQueries, TASK_STATUS_TONE, TaskStatusBadge } from '@/entities/task'
import { cn, formatDateTime, formatDateTimeFull } from '@/shared/lib'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  Skeleton,
} from '@/shared/ui'

const WRAPPING_BADGE = 'h-auto min-h-5 max-w-full min-w-0 shrink whitespace-normal'

/** Status changes of a task as a vertical timeline, oldest first (the creation is the first entry). */
export function TaskHistory({ taskId, className }: { taskId: string; className?: string }) {
  const { t } = useTranslation('task')
  const history = useQuery(taskQueries.history(taskId))

  return (
    <Card className={cn('min-w-0', className)}>
      <CardHeader>
        <h2 className="text-base leading-snug font-medium">{t('history.title')}</h2>
      </CardHeader>
      <CardContent>
        {history.isPending ? <Skeleton className="h-16 w-full" /> : null}
        {history.isError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription className="flex flex-wrap items-center gap-2">
              {t('history.loadError')}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void history.refetch()
                }}
              >
                {t('history.retry')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {history.isSuccess && history.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('history.empty')}</p>
        ) : null}
        {history.isSuccess && history.data.length > 0 ? (
          <ol className="ms-1.5 flex flex-col border-s">
            {history.data.map((entry) => (
              <li
                key={entry.id}
                className="relative flex min-w-0 flex-col gap-1.5 ps-5 pb-5 text-sm last:pb-0"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute -start-[6.5px] top-1.5 size-3 rounded-full ring-4 ring-card',
                    TASK_STATUS_TONE[entry.to_status].dot,
                  )}
                />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {entry.from_status ? (
                    <>
                      <TaskStatusBadge status={entry.from_status} className={WRAPPING_BADGE} />
                      <ArrowRightIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                      <span className="sr-only">{t('history.changedTo')}</span>
                    </>
                  ) : (
                    <span className="font-medium">{t('history.created')}</span>
                  )}
                  <TaskStatusBadge status={entry.to_status} className={WRAPPING_BADGE} />
                </div>
                <p className="[overflow-wrap:anywhere] text-muted-foreground">
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {entry.changed_by.full_name}
                  </span>
                  {', '}
                  <time dateTime={entry.changed_at} title={formatDateTimeFull(entry.changed_at)}>
                    {formatDateTime(entry.changed_at)}
                  </time>
                </p>
                {entry.comment ? (
                  <blockquote className="border-s-2 ps-3 [overflow-wrap:anywhere] whitespace-pre-wrap">
                    {entry.comment}
                  </blockquote>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
      </CardContent>
    </Card>
  )
}
