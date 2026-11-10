import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { taskQueries, type BoardTaskRow, type TaskStatus } from '@/entities/task'
import { MAX_PAGE_SIZE } from '@/shared/api'

import { BOARD_COLUMN_STEP, BOARD_STATUS_ORDER, nextColumnLimit } from './board'

export interface BoardColumnData {
  status: TaskStatus
  rows: readonly BoardTaskRow[]
  total: number | undefined
  state: 'loading' | 'error' | 'ready'
  isLoadingMore: boolean
  isFilterPending: boolean
  canShowMore: boolean
  remaining: number
  capped: { shown: number; total: number } | undefined
  showMore: () => void
  retry: () => void
}

type Limits = Readonly<Partial<Record<TaskStatus, number>>>

interface KeyedLimits {
  filterKey: string
  limits: Limits
}

/**
 * One column query. A separate `useQuery` per column (not `useQueries`) keeps the observer when
 * the filter changes, so `keepPreviousData` can show the old rows while the new ones load.
 */
function useColumnQuery(
  { status, limit }: { status: TaskStatus; limit: number },
  objectIds: readonly string[],
) {
  return useQuery(taskQueries.boardColumn({ status, objectIds, limit }))
}

/**
 * The five column queries of the board (one per status, so a failing column does not break the
 * others) and the local «Show more» limits. The limits are stored with the filter they belong to,
 * so a new filter starts from the first page without remounting: the previous columns stay on
 * screen (`isFilterPending`) until the new data arrives.
 */
export function useBoardData(objectIds: readonly string[]) {
  const filterKey = [...objectIds].sort().join(',')
  const [stored, setStored] = useState<KeyedLimits>({ filterKey, limits: {} })
  const limits: Limits = stored.filterKey === filterKey ? stored.limits : {}
  const column = (status: TaskStatus) => ({
    status,
    limit: limits[status] ?? BOARD_COLUMN_STEP,
  })
  const byStatus: Record<TaskStatus, ReturnType<typeof useColumnQuery>> = {
    new: useColumnQuery(column('new'), objectIds),
    in_progress: useColumnQuery(column('in_progress'), objectIds),
    in_review: useColumnQuery(column('in_review'), objectIds),
    rework: useColumnQuery(column('rework'), objectIds),
    accepted: useColumnQuery(column('accepted'), objectIds),
  }

  const columns = BOARD_STATUS_ORDER.map((status): BoardColumnData => {
    const result = byStatus[status]
    const limit = limits[status] ?? BOARD_COLUMN_STEP
    const rows = result.data?.rows ?? []
    const total = result.data?.total
    const hidden = Math.max((total ?? 0) - rows.length, 0)
    const state = result.data !== undefined ? 'ready' : result.isError ? 'error' : 'loading'
    const isPlaceholder = result.isPlaceholderData
    return {
      status,
      rows,
      total,
      state,
      isLoadingMore: isPlaceholder && limit > BOARD_COLUMN_STEP,
      isFilterPending: isPlaceholder && limit <= BOARD_COLUMN_STEP,
      canShowMore: hidden > 0 && limit < MAX_PAGE_SIZE,
      remaining: Math.min(hidden, BOARD_COLUMN_STEP),
      capped:
        hidden > 0 && limit >= MAX_PAGE_SIZE
          ? { shown: rows.length, total: total ?? 0 }
          : undefined,
      showMore: () => {
        setStored((previous) => {
          const current = previous.filterKey === filterKey ? previous.limits : {}
          return {
            filterKey,
            limits: { ...current, [status]: nextColumnLimit(current[status] ?? BOARD_COLUMN_STEP) },
          }
        })
      },
      retry: () => {
        void result.refetch()
      },
    }
  })

  const isFilterPending = columns.some((column) => column.isFilterPending)

  return {
    columns,
    isFilterPending,
    isReady: columns.every((column) => column.state === 'ready'),
    isEmpty:
      !isFilterPending && columns.every((column) => column.state === 'ready' && column.total === 0),
  }
}
