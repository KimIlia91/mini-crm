import type {
  ColumnFiltersState,
  OnChangeFn,
  PaginationState,
  SortingState,
  Table,
} from '@tanstack/react-table'
import { useCallback, useEffect, useMemo } from 'react'

import { useLiveSearchParams } from './hooks/use-live-search-params'
import { rememberListSearch } from './list-state'

const SEARCH_PARAM = 'q'
const STATUS_PARAM = 'status'
const PAGE_PARAM = 'page'
const SIZE_PARAM = 'size'
const SORT_PARAM = 'sort'

export interface TableUrlStateOptions {
  pageSizes: readonly number[]
  statusValues?: readonly string[]
  statusColumnId?: string
  sortableIds?: readonly string[]
  defaultSorting?: SortingState
  listKey?: string
}

export interface TableUrlState {
  globalFilter: string
  statuses: readonly string[]
  columnFilters: ColumnFiltersState
  pagination: PaginationState
  sorting: SortingState
  onSortingChange: OnChangeFn<SortingState>
  onGlobalFilterChange: OnChangeFn<string>
  resetPage: () => void
  onColumnFiltersChange: OnChangeFn<ColumnFiltersState>
  onPaginationChange: OnChangeFn<PaginationState>
}

function parsePositiveInt(value: string | null): number | null {
  if (value === null || !/^\d{1,6}$/.test(value)) return null
  const parsed = Number(value)
  return parsed >= 1 ? parsed : null
}

/** TanStack passes either the next value or a function of the previous one. */
function resolve<T>(updater: T | ((old: T) => T), old: T): T {
  return updater instanceof Function ? updater(old) : updater
}

/**
 * Search, status facet and pagination of a table kept in the URL (`q`, `status`, `page`, `size`),
 * so a filtered view survives reload and can be shared. Anything invalid falls back to defaults.
 * Typing in the search box replaces the history entry; other changes push one.
 * Pass the result to `useReactTable({ state, on...Change })` together with `autoResetPageIndex: false`.
 */
const NO_SORT_IDS: readonly string[] = []
const NO_SORTING: SortingState = []

export function useTableUrlState({
  pageSizes,
  statusValues,
  statusColumnId = 'status',
  sortableIds = NO_SORT_IDS,
  defaultSorting = NO_SORTING,
  listKey,
}: TableUrlStateOptions): TableUrlState {
  const [searchParams, setSearchParams] = useLiveSearchParams()
  const searchString = searchParams.toString()

  useEffect(() => {
    if (listKey !== undefined) rememberListSearch(listKey, searchString)
  }, [listKey, searchString])

  const defaultSize = pageSizes[0] ?? 10

  const globalFilter = searchParams.get(SEARCH_PARAM) ?? ''
  const statusParam = searchParams.get(STATUS_PARAM)
  const page = parsePositiveInt(searchParams.get(PAGE_PARAM)) ?? 1
  const sizeParam = parsePositiveInt(searchParams.get(SIZE_PARAM))
  const pageSize = sizeParam !== null && pageSizes.includes(sizeParam) ? sizeParam : defaultSize

  const statuses = useMemo<readonly string[]>(() => {
    const requested = statusParam === null ? [] : statusParam.split(',')
    return [...new Set(requested)].filter((value) =>
      statusValues === undefined ? value !== '' : statusValues.includes(value),
    )
  }, [statusParam, statusValues])
  const columnFilters = useMemo<ColumnFiltersState>(
    () => (statuses.length > 0 ? [{ id: statusColumnId, value: statuses }] : []),
    [statuses, statusColumnId],
  )

  const sortParam = searchParams.get(SORT_PARAM)
  const sorting = useMemo<SortingState>(() => {
    if (sortParam === null) return defaultSorting
    const desc = sortParam.startsWith('-')
    const id = desc ? sortParam.slice(1) : sortParam
    return sortableIds.includes(id) ? [{ id, desc }] : defaultSorting
  }, [sortParam, sortableIds, defaultSorting])

  const pagination = useMemo<PaginationState>(
    () => ({ pageIndex: page - 1, pageSize }),
    [page, pageSize],
  )

  const onGlobalFilterChange = useCallback<OnChangeFn<string>>(
    (updater) => {
      const next = resolve(updater, globalFilter)
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous)
          if (next === '') params.delete(SEARCH_PARAM)
          else params.set(SEARCH_PARAM, next)
          return params
        },
        { replace: true },
      )
    },
    [globalFilter, setSearchParams],
  )

  const resetPage = useCallback(() => {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous)
        params.delete(PAGE_PARAM)
        return params
      },
      { replace: true },
    )
  }, [setSearchParams])

  const onSortingChange = useCallback<OnChangeFn<SortingState>>(
    (updater) => {
      const next = resolve(updater, sorting)[0]
      const isDefault =
        next === undefined ||
        (defaultSorting[0]?.id === next.id && defaultSorting[0].desc === next.desc)
      setSearchParams((previous) => {
        const params = new URLSearchParams(previous)
        if (isDefault) params.delete(SORT_PARAM)
        else params.set(SORT_PARAM, `${next.desc ? '-' : ''}${next.id}`)
        params.delete(PAGE_PARAM)
        return params
      })
    },
    [sorting, defaultSorting, setSearchParams],
  )

  const onColumnFiltersChange = useCallback<OnChangeFn<ColumnFiltersState>>(
    (updater) => {
      const next = resolve(updater, columnFilters)
      const value: unknown = next.find((filter) => filter.id === statusColumnId)?.value
      const statuses = Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : []
      setSearchParams((previous) => {
        const params = new URLSearchParams(previous)
        if (statuses.length === 0) params.delete(STATUS_PARAM)
        else params.set(STATUS_PARAM, statuses.join(','))
        params.delete(PAGE_PARAM)
        return params
      })
    },
    [columnFilters, statusColumnId, setSearchParams],
  )

  const onPaginationChange = useCallback<OnChangeFn<PaginationState>>(
    (updater) => {
      const next = resolve(updater, pagination)
      const sizeChanged = next.pageSize !== pagination.pageSize
      setSearchParams((previous) => {
        const params = new URLSearchParams(previous)
        if (next.pageSize === defaultSize) params.delete(SIZE_PARAM)
        else params.set(SIZE_PARAM, String(next.pageSize))
        if (sizeChanged || next.pageIndex <= 0) params.delete(PAGE_PARAM)
        else params.set(PAGE_PARAM, String(next.pageIndex + 1))
        return params
      })
    },
    [pagination, defaultSize, setSearchParams],
  )

  return {
    globalFilter,
    statuses,
    columnFilters,
    pagination,
    sorting,
    onSortingChange,
    onGlobalFilterChange,
    resetPage,
    onColumnFiltersChange,
    onPaginationChange,
  }
}

/**
 * Fixes a page past the end of the data (stale URL, deleted rows): moves to the last page, or drops
 * the page when there are no rows. Replaces the history entry, so "back" does not return to it.
 */
export function useClampPageIndex<TData>(table: Table<TData>, enabled = true): void {
  const [, setSearchParams] = useLiveSearchParams()
  const pageCount = table.getPageCount()
  const { pageIndex } = table.getState().pagination
  useEffect(() => {
    if (!enabled || pageIndex < Math.max(pageCount, 1)) return
    const lastPage = pageCount
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous)
        if (lastPage <= 1) params.delete(PAGE_PARAM)
        else params.set(PAGE_PARAM, String(lastPage))
        return params
      },
      { replace: true },
    )
  }, [enabled, pageCount, pageIndex, setSearchParams])
}
