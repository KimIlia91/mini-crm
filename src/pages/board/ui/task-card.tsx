import { cn } from 'cn'
import { useState, type ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import type { BoardTaskRow, TaskStatus, TransitionRule } from '@/entities/task'
import { formatDateTime } from '@/shared/lib'
import { Button, Spinner, textLinkClass } from '@/shared/ui'

type TaskLinkProps = Omit<ComponentProps<typeof Link>, 'to' | 'children'>

interface TaskCardProps {
  task: BoardTaskRow
  showObject: boolean
  showAssignee: boolean
  transitions: readonly TransitionRule[]
  movesDisabled: boolean
  isPending: boolean
  pendingTo?: TaskStatus
  draggable: boolean
  onMove: (to: TaskStatus) => void
  onDragStart: () => void
  onDragEnd: () => void
  linkProps?: TaskLinkProps
}

/** A board card: the title opens the task, buttons are the keyboard and touch way to move it. */
export function TaskCard({
  task,
  showObject,
  showAssignee,
  transitions,
  movesDisabled,
  isPending,
  pendingTo,
  draggable,
  onMove,
  onDragStart,
  onDragEnd,
  linkProps,
}: TaskCardProps) {
  const { t } = useTranslation('entity-task')
  const [isDragging, setIsDragging] = useState(false)
  const canDrag = draggable && transitions.length > 0

  return (
    <article
      data-slot="board-card"
      aria-busy={isPending}
      draggable={canDrag}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', task.id)
        event.dataTransfer.effectAllowed = 'move'
        setTimeout(() => {
          setIsDragging(true)
        }, 0)
        onDragStart()
      }}
      onDragEnd={() => {
        setIsDragging(false)
        onDragEnd()
      }}
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-3 text-card-foreground shadow-xs transition-opacity motion-reduce:transition-none',
        canDrag && 'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-40',
      )}
    >
      <Link
        {...linkProps}
        to={`/tasks/${task.id}`}
        title={task.title}
        draggable={false}
        className={cn(textLinkClass, 'min-h-11 items-start py-2 sm:min-h-6 sm:py-0.5')}
      >
        <span className="line-clamp-3 [overflow-wrap:anywhere]">{task.title}</span>
      </Link>
      <div className="flex min-w-0 flex-col gap-0.5 text-xs text-muted-foreground">
        {showObject ? (
          <p className="line-clamp-1 [overflow-wrap:anywhere]" title={task.object.name}>
            {task.object.name}
          </p>
        ) : null}
        {showAssignee ? (
          <p className="line-clamp-1 [overflow-wrap:anywhere]" title={task.assignee.full_name}>
            {task.assignee.full_name}
          </p>
        ) : null}
        <time dateTime={task.created_at} className="line-clamp-1 [overflow-wrap:anywhere]">
          {formatDateTime(task.created_at)}
        </time>
      </div>
      {transitions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {transitions.map((rule) => {
            const pressed = isPending && pendingTo === rule.to_status
            return (
              <Button
                key={rule.to_status}
                type="button"
                variant="outline"
                disabled={movesDisabled || isPending}
                aria-busy={pressed}
                onClick={() => {
                  onMove(rule.to_status)
                }}
                className="h-11 max-w-full whitespace-normal sm:h-8 sm:px-2.5"
              >
                {pressed ? <Spinner aria-hidden="true" data-icon="inline-start" /> : null}
                {t(`transition.${rule.to_status}`)}
              </Button>
            )
          })}
        </div>
      ) : null}
    </article>
  )
}
