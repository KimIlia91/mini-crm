import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { useTaskErrorMessage, type TaskStatus } from '@/entities/task'
import { TransitionCommentDialog } from '@/features/transition-comment'
import { Alert, AlertDescription, Button, toast } from '@/shared/ui'

import type { TaskMove } from '../model/use-task-move'
import { boardColumnHeadingId } from './board-column-id'

/** Focus goes to the card link, else the column heading, else the open tab panel; never to body. */
function focusBoardTarget(taskId: string, status: TaskStatus) {
  const link = document.querySelector<HTMLElement>(`[data-row-link="${taskId}"]`)
  const target =
    link ??
    document.getElementById(boardColumnHeadingId(status)) ??
    document.querySelector<HTMLElement>('[role="tabpanel"]')
  target?.focus({ preventScroll: true })
}

/**
 * Everything a move shows: the error banner (kept apart from the board, so an emptied board or a
 * missing object cannot hide it), the comment dialog, the success toast and the focus afterwards.
 */
export function MoveLayer({ move }: { move: TaskMove }) {
  const { t } = useTranslation('board')
  const { t: tTask } = useTranslation('entity-task')
  const taskErrorMessage = useTaskErrorMessage()
  const { lastMoved } = move

  useEffect(() => {
    if (lastMoved === null) return
    toast(t('moved', { title: lastMoved.title, status: tTask(`status.${lastMoved.to}`) }))
    focusBoardTarget(lastMoved.id, lastMoved.to)
  }, [lastMoved, t, tTask])

  return (
    <>
      {move.bannerError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            {t('moveError', {
              title: move.bannerError.title,
              message: taskErrorMessage(move.bannerError.error),
            })}
            <Button type="button" size="sm" variant="outline" onClick={move.dismissError}>
              {t('dismiss')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <TransitionCommentDialog
        open={move.commentTarget !== null}
        onOpenChange={(open) => {
          if (!open) move.closeComment()
        }}
        label={move.commentTo ? tTask(`transition.${move.commentTo}`) : ''}
        isPending={move.isPending}
        error={move.commentError}
        onSubmit={move.submitComment}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (lastMoved !== null) return
          const origin = move.getOrigin()
          if (origin?.element?.isConnected === true) origin.element.focus({ preventScroll: true })
          else if (origin) focusBoardTarget(origin.taskId, origin.status)
        }}
      />
    </>
  )
}
