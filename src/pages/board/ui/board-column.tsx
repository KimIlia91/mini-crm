import { cn } from 'cn'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { TASK_STATUS_ICON, TASK_STATUS_TONE, type TaskStatus } from '@/entities/task'
import { boardColumnHeadingId } from './board-column-id'
import { Alert, AlertDescription, Button, Skeleton, Spinner } from '@/shared/ui'

interface BoardColumnProps {
  status: TaskStatus
  total?: number
  state: 'loading' | 'error' | 'ready'
  onRetry: () => void
  dropState: 'idle' | 'allowed' | 'blocked'
  dropHint?: 'move' | 'comment'
  onDropTask: () => void
  canShowMore: boolean
  remaining: number
  isLoadingMore: boolean
  onShowMore: () => void
  capped?: { shown: number; total: number }
  bare?: boolean
  children: ReactNode
}

/**
 * One status column. With `bare` it renders only the body: the tab above already carries the
 * title and the count, and there is no drag and drop on narrow screens.
 */
export function BoardColumn({
  status,
  total,
  state,
  onRetry,
  dropState,
  dropHint,
  onDropTask,
  canShowMore,
  remaining,
  isLoadingMore,
  onShowMore,
  capped,
  bare = false,
  children,
}: BoardColumnProps) {
  const { t } = useTranslation('board')
  const { t: tTask } = useTranslation('entity-task')
  const Icon = TASK_STATUS_ICON[status]
  const tone = TASK_STATUS_TONE[status]
  const headingId = boardColumnHeadingId(status)
  const isAllowed = dropState === 'allowed'

  const body = (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col gap-2',
        !bare && 'overflow-y-auto p-2',
        dropState === 'blocked' && 'opacity-50',
      )}
    >
      {isAllowed && dropHint ? (
        <p className="rounded-md border border-dashed border-primary px-2 py-1.5 text-center text-sm font-medium text-primary">
          {t(`dropHint.${dropHint}`)}
        </p>
      ) : null}
      {state === 'loading' ? (
        <div className="flex flex-col gap-2" role="status" aria-label={t('loading')}>
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
        </div>
      ) : null}
      {state === 'error' ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            {t('columnLoadError')}
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {state === 'ready' ? (
        <>
          {total === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">
              {t('columnEmpty')}
            </p>
          ) : (
            children
          )}
          {canShowMore ? (
            <Button
              type="button"
              variant="outline"
              disabled={isLoadingMore}
              aria-busy={isLoadingMore}
              onClick={onShowMore}
              className="h-11 sm:h-8"
            >
              {isLoadingMore ? <Spinner aria-hidden="true" data-icon="inline-start" /> : null}
              {t('showMore', { count: remaining })}
            </Button>
          ) : null}
          {capped ? (
            <p className="text-center text-xs text-muted-foreground">
              {t('capped', { shown: capped.shown, total: capped.total })}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  )

  if (bare) return body

  return (
    <section
      aria-labelledby={headingId}
      data-drop-state={dropState}
      onDragOver={(event) => {
        if (!isAllowed) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(event) => {
        if (!isAllowed) return
        event.preventDefault()
        onDropTask()
      }}
      className={cn(
        'flex max-h-full min-h-0 w-full min-w-0 flex-col rounded-lg border bg-muted/40 transition-colors motion-reduce:transition-none',
        isAllowed && 'border-primary bg-primary/5 ring-1 ring-primary',
      )}
    >
      <h2
        id={headingId}
        tabIndex={-1}
        className="flex items-center gap-2 px-3 py-2.5 text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Icon aria-hidden="true" className={cn('size-4 shrink-0', tone.icon)} />
        <span className="min-w-0 flex-1 truncate">{tTask(`status.${status}`)}</span>
        {total === undefined ? null : (
          <span className="font-normal text-muted-foreground tabular-nums">{total}</span>
        )}
      </h2>
      {body}
    </section>
  )
}
