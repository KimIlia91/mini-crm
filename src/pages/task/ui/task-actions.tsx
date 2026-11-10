import { useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Viewer } from '@/entities/profile'
import {
  getAvailableTransitions,
  transitionQueries,
  useChangeTaskStatus,
  useTaskErrorMessage,
  type TaskStatus,
} from '@/entities/task'
import { TransitionCommentDialog } from '@/features/transition-comment'
import { Alert, AlertDescription, Button, Skeleton } from '@/shared/ui'

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
  const [commentFor, setCommentFor] = useState<TaskStatus | null>(null)
  const opener = useRef<HTMLElement | null>(null)

  if (rules.isPending) return <Skeleton className="h-9 w-40" />
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
  if (available.length === 0 && !change.isError) return null

  return (
    <>
      {available.map((rule) => {
        const label = tTask(`transition.${rule.to_status}`)
        return rule.comment_required ? (
          <Button
            key={rule.to_status}
            variant="outline"
            disabled={change.isPending}
            onClick={(event) => {
              opener.current = event.currentTarget
              change.reset()
              setCommentFor(rule.to_status)
            }}
          >
            {label}
          </Button>
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
      {commentFor !== null && available.some((rule) => rule.to_status === commentFor) ? (
        <TransitionCommentDialog
          open
          onOpenChange={(open) => {
            if (!open) setCommentFor(null)
          }}
          label={tTask(`transition.${commentFor}`)}
          isPending={change.isPending}
          error={change.error}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (opener.current?.isConnected === true) opener.current.focus()
          }}
          onSubmit={(comment) => {
            change.mutate(
              { taskId: task.id, toStatus: commentFor, comment },
              {
                onSuccess: () => {
                  setCommentFor(null)
                },
              },
            )
          }}
        />
      ) : null}
      {change.isError ? (
        <Alert variant="destructive" role="alert" className="w-72 max-w-full basis-full">
          <AlertDescription>{taskErrorMessage(change.error)}</AlertDescription>
        </Alert>
      ) : null}
    </>
  )
}
