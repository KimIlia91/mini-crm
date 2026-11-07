import { getCoreRowModel, useReactTable, type ColumnDef, type Table } from '@tanstack/react-table'

import { useClampPageIndex, type TableUrlState } from './use-table-url-state'

interface DataTableOptions<TData> {
  data: TData[]
  columns: ColumnDef<TData>[]
  rowCount: number
  urlState: TableUrlState
  isLoading?: boolean
}

/**
 * A TanStack table in server mode: filtering, sorting and pagination are done by the server, the
 * table only shows what it is given and reports changes into the URL. Columns must be stable
 * (memoised) — they usually depend on `t`.
 */
export function useDataTable<TData>({
  data,
  columns,
  rowCount,
  urlState,
  isLoading = false,
}: DataTableOptions<TData>): Table<TData> {
  const table = useReactTable({
    data,
    columns,
    rowCount,
    state: {
      sorting: urlState.sorting,
      globalFilter: urlState.globalFilter,
      columnFilters: urlState.columnFilters,
      pagination: urlState.pagination,
    },
    onSortingChange: urlState.onSortingChange,
    onGlobalFilterChange: urlState.onGlobalFilterChange,
    onColumnFiltersChange: urlState.onColumnFiltersChange,
    onPaginationChange: urlState.onPaginationChange,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
  })
  useClampPageIndex(table, !isLoading)
  return table
}
