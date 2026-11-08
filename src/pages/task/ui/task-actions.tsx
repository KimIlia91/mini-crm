import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import type { Viewer } from '@/entities/profile'
import {
  getAvailableTransitions,
  transitionQueries,
  useChangeTaskStatus,
  useTaskErrorMessage,
  type TaskStatus,
} from '@/entities/task'
import { Alert, AlertDescription, Button, Skeleton } from '@/shared/ui'

import { CommentDialog } from './comment-dialog'

interface TaskActionsProps {
  task: { id: string; status: TaskStatus; assignee_id: string }
  viewer: Pick<Viewer, 'id' | 'role'>
}

/**
 * Buttons only for transitions the viewer may perform now (the database re-checks every one).
 * Renders into the page header's action group; a failure is shown on its own full-width row.
 */
export function TaskActions({ task, viewer }: TaskActionsProps) {
  const { t } = useTranslation('task')
  const { t: tTask } = useTranslation('entity-task')
  const taskErrorMessage = useTaskErrorMessage()
  const rules = useQuery(transitionQueries.all())
  const change = useChangeTaskStatus()

  if (rules.isPending) return <Skeleton className="h-9 w-40" />
  // A failed background refetch keeps the cached rules, so the open comment dialog stays mounted.
  if (rules.isError && rules.data === undefined) {
    return (
      <Alert variant="destructive" role="alert" className="w-72 max-w-full">
        <AlertDescription className="flex flex-wrap items-center gap-2">
          {t('actionsLoadError')}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void rules.refetch()
            }}
          >
            {t('retry')}
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const available = getAvailableTransitions(rules.data, task, viewer)
  // After a failed transition the refetch may leave no actions; the error must stay visible.
  if (available.length === 0 && !change.isError) return null

  return (
    <>
      {available.map((rule) => {
        const label = tTask(`transition.${rule.to_status}`)
        return rule.comment_required ? (
          <CommentDialog
            key={rule.to_status}
            label={label}
            disabled={change.isPending}
            isPending={change.isPending}
            error={change.error}
            onOpen={change.reset}
            onSubmit={(comment, onDone) => {
              change.mutate(
                { taskId: task.id, toStatus: rule.to_status, comment },
                { onSuccess: onDone },
              )
            }}
          />
        ) : (
          <Button
            key={rule.to_status}
            disabled={change.isPending}
            onClick={() => {
              change.mutate({ taskId: task.id, toStatus: rule.to_status })
            }}
          >
            {label}
          </Button>
        )
      })}
      {change.isError ? (
        <Alert variant="destructive" role="alert" className="w-72 max-w-full basis-full">
          <AlertDescription>{taskErrorMessage(change.error)}</AlertDescription>
        </Alert>
      ) : null}
    </>
  )
}
