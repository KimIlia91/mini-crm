import { useCallback, useEffect, useMemo } from 'react'

import type { AppRole } from '@/entities/profile'
import type { TaskStatus } from '@/entities/task'
import { rememberListSearch, useLiveSearchParams } from '@/shared/lib'

import { parseObjectIds, pickBoardColumn } from './board'

const OBJECT_PARAM = 'object'
const COLUMN_PARAM = 'column'

export const BOARD_LIST_KEY = 'board'

export interface BoardUrlState {
  /** Valid, distinct object ids from the URL (empty = all objects). */
  objectIds: readonly string[]
  column: TaskStatus
  /** Changing the filter is a navigation step: «back» returns to the previous filter. */
  setObjectIds: (objectIds: readonly string[]) => void
  /** Drops ids that turned out not to exist; replaces the history entry. */
  dropObjectIds: (objectIds: readonly string[]) => void
  /** Switching the visible column replaces the history entry. */
  setColumn: (column: TaskStatus) => void
}

function withObjectIds(previous: URLSearchParams, objectIds: readonly string[]): URLSearchParams {
  const params = new URLSearchParams(previous)
  params.delete(OBJECT_PARAM)
  for (const id of objectIds) params.append(OBJECT_PARAM, id)
  return params
}

/**
 * The board's filter (`object`, repeated) and active column (`column`) kept in the URL. Malformed
 * and duplicate object ids are ignored at once and removed from the URL without a history entry.
 */
export function useBoardUrlState(role: AppRole): BoardUrlState {
  const [searchParams, setSearchParams] = useLiveSearchParams()
  const searchString = searchParams.toString()
  const objectIds = useMemo(
    () => parseObjectIds(new URLSearchParams(searchString).getAll(OBJECT_PARAM)),
    [searchString],
  )
  const column = pickBoardColumn(searchParams.get(COLUMN_PARAM), role)
  const isDirty = searchParams.getAll(OBJECT_PARAM).join(',') !== objectIds.join(',')

  useEffect(() => {
    rememberListSearch(BOARD_LIST_KEY, searchString)
  }, [searchString])

  useEffect(() => {
    if (!isDirty) return
    setSearchParams((previous) => withObjectIds(previous, objectIds), { replace: true })
  }, [isDirty, objectIds, setSearchParams])

  const setObjectIds = useCallback(
    (next: readonly string[]) => {
      setSearchParams((previous) => withObjectIds(previous, next))
    },
    [setSearchParams],
  )

  const dropObjectIds = useCallback(
    (dropped: readonly string[]) => {
      setSearchParams(
        (previous) =>
          withObjectIds(
            previous,
            previous.getAll(OBJECT_PARAM).filter((id) => !dropped.includes(id)),
          ),
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const setColumn = useCallback(
    (next: TaskStatus) => {
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous)
          params.set(COLUMN_PARAM, next)
          return params
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  return { objectIds, column, setObjectIds, dropObjectIds, setColumn }
}
