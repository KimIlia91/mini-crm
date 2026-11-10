import type { UseQueryResult } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import type { AppRole } from '@/entities/profile'
import { getAvailableTransitions, type TaskStatus, type TransitionRule } from '@/entities/task'
import { useMediaQuery, useRestoreOpenedRow } from '@/shared/lib'
import {
  Alert,
  AlertDescription,
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/shared/ui'

import { findTransition, type MoveTask } from '../model/board'
import { useBoardData } from '../model/use-board-data'
import type { TaskMove } from '../model/use-task-move'
import { BoardColumns } from './board-columns'

const WIDE_QUERY = '(min-width: 40rem)'
const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)'
const NO_RULES: never[] = []

interface BoardContentProps {
  viewer: { id: string; role: AppRole }
  rules: UseQueryResult<TransitionRule[]>
  move: TaskMove
  objectIds: readonly string[]
  column: TaskStatus
  onColumnChange: (status: TaskStatus) => void
  onResetFilter: () => void
}

/** The board itself; on a filter change it keeps the previous columns (dimmed, busy) until the new ones load. */
export function BoardContent({
  viewer,
  rules,
  move,
  objectIds,
  column,
  onColumnChange,
  onResetFilter,
}: BoardContentProps) {
  const { t } = useTranslation('board')
  const isWide = useMediaQuery(WIDE_QUERY)
  const hasFinePointer = useMediaQuery(FINE_POINTER_QUERY)
  const board = useBoardData(objectIds)
  const [dragged, setDragged] = useState<MoveTask | null>(null)
  const rulesLoaded = rules.data !== undefined
  const canDrag = isWide && hasFinePointer && rulesLoaded && !move.isPending

  useRestoreOpenedRow('board', board.isReady)

  const transitionsFor = (task: MoveTask) =>
    rules.data ? getAvailableTransitions(rules.data, task, viewer) : NO_RULES

  const dropRuleFor = (status: TaskStatus) =>
    dragged && rules.data ? findTransition(rules.data, dragged, viewer, status) : undefined

  if (board.isEmpty) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            {objectIds.length > 0
              ? t(objectIds.length > 1 ? 'emptyFilteredMany' : 'emptyFiltered')
              : viewer.role === 'executor'
                ? t('emptyExecutor')
                : t('emptyManager')}
          </EmptyTitle>
          <EmptyDescription>
            {objectIds.length > 0
              ? t(objectIds.length > 1 ? 'emptyFilteredManyHint' : 'emptyFilteredHint')
              : viewer.role === 'executor'
                ? t('emptyExecutorHint')
                : t('emptyManagerHint')}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {objectIds.length > 0 ? (
            <Button type="button" variant="outline" onClick={onResetFilter}>
              {t('filter.reset')}
            </Button>
          ) : viewer.role === 'manager' ? (
            <Button asChild variant="outline">
              <Link to="/objects">{t('toObjects')}</Link>
            </Button>
          ) : null}
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 fit-screen:min-h-0 fit-screen:flex-1">
      {rules.isError && !rulesLoaded ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            {t('rulesLoadError')}
            <Button
              type="button"
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
      ) : null}
      <div
        aria-busy={board.isFilterPending}
        className="flex min-w-0 flex-col transition-opacity data-[pending=true]:opacity-60 motion-reduce:transition-none fit-screen:min-h-0 fit-screen:flex-1"
        data-pending={board.isFilterPending}
      >
        <BoardColumns
          columns={board.columns}
          isWide={isWide}
          activeColumn={column}
          onColumnChange={onColumnChange}
          showObject={objectIds.length !== 1}
          showAssignee={viewer.role === 'manager'}
          transitionsFor={transitionsFor}
          movesDisabled={move.isPending}
          pending={move.pending}
          canDrag={canDrag}
          dragged={dragged}
          dropRuleFor={dropRuleFor}
          onMove={move.request}
          onDragStart={setDragged}
          onDragEnd={() => {
            setDragged(null)
          }}
          onDropTask={(status) => {
            if (dragged) move.request(dragged, status)
            setDragged(null)
          }}
        />
      </div>
    </div>
  )
}
