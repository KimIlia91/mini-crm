import { useTranslation } from 'react-i18next'

import type { BoardTaskRow, TaskStatus, TransitionRule } from '@/entities/task'
import { openedRowLink } from '@/shared/lib'

import { BOARD_STATUS_ORDER, type MoveTask } from '../model/board'
import type { BoardColumnData } from '../model/use-board-data'
import { BoardColumn } from './board-column'
import { BoardColumnSwitch } from './board-column-switch'
import { TaskCard } from './task-card'

interface BoardColumnsProps {
  columns: readonly BoardColumnData[]
  isWide: boolean
  activeColumn: TaskStatus
  onColumnChange: (status: TaskStatus) => void
  showObject: boolean
  showAssignee: boolean
  transitionsFor: (task: BoardTaskRow) => readonly TransitionRule[]
  movesDisabled: boolean
  pending: { id: string; to: TaskStatus } | null
  canDrag: boolean
  dragged: MoveTask | null
  dropRuleFor: (status: TaskStatus) => TransitionRule | undefined
  onMove: (task: MoveTask, to: TaskStatus) => void
  onDragStart: (task: MoveTask) => void
  onDragEnd: () => void
  onDropTask: (status: TaskStatus) => void
}

/** The columns of the board: all five side by side from sm (640 px), one at a time with tabs below. */
export function BoardColumns({
  columns,
  isWide,
  activeColumn,
  onColumnChange,
  showObject,
  showAssignee,
  transitionsFor,
  movesDisabled,
  pending,
  canDrag,
  dragged,
  dropRuleFor,
  onMove,
  onDragStart,
  onDragEnd,
  onDropTask,
}: BoardColumnsProps) {
  const { t } = useTranslation('board')

  const renderColumn = (data: BoardColumnData, bare: boolean) => {
    const dropRule = dropRuleFor(data.status)
    const dropState = dragged === null ? 'idle' : dropRule ? 'allowed' : 'blocked'
    return (
      <BoardColumn
        key={data.status}
        status={data.status}
        total={data.total}
        state={data.state}
        onRetry={data.retry}
        dropState={dropState}
        dropHint={dropRule?.comment_required ? 'comment' : 'move'}
        onDropTask={() => {
          onDropTask(data.status)
        }}
        canShowMore={data.canShowMore}
        remaining={data.remaining}
        isLoadingMore={data.isLoadingMore}
        onShowMore={data.showMore}
        capped={data.capped}
        bare={bare}
      >
        {data.rows.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            showObject={showObject}
            showAssignee={showAssignee}
            transitions={transitionsFor(task)}
            movesDisabled={movesDisabled}
            isPending={pending?.id === task.id}
            pendingTo={pending?.id === task.id ? pending.to : undefined}
            draggable={canDrag}
            onMove={(to) => {
              onMove(task, to)
            }}
            onDragStart={() => {
              onDragStart(task)
            }}
            onDragEnd={onDragEnd}
            linkProps={openedRowLink('board', task.id)}
          />
        ))}
      </BoardColumn>
    )
  }

  if (!isWide) {
    const active = columns.find((data) => data.status === activeColumn)
    const totals = Object.fromEntries(columns.map((data) => [data.status, data.total]))
    return (
      <BoardColumnSwitch
        value={activeColumn}
        statuses={BOARD_STATUS_ORDER}
        totals={totals}
        onChange={onColumnChange}
      >
        {active ? renderColumn(active, true) : null}
      </BoardColumnSwitch>
    )
  }

  return (
    <div
      role="region"
      aria-label={t('region')}
      tabIndex={0}
      className="grid min-h-0 grid-cols-[repeat(5,minmax(18rem,1fr))] gap-3 overflow-x-auto rounded-lg pb-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 fit-screen:flex-1"
    >
      {columns.map((data) => renderColumn(data, false))}
    </div>
  )
}
