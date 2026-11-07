/*
 * Adapted from shadcn-admin (https://github.com/satnaing/shadcn-admin),
 * Copyright (c) 2024 Sat Naing, MIT License. See THIRD_PARTY_NOTICES.md.
 */
import type { Table } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { XIcon } from 'lucide-react'

import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'

import { DataTableFacetedFilter, type DataTableFilterOption } from './faceted-filter'
import { DataTableViewOptions } from './view-options'

interface DataTableToolbarProps<TData> {
  table: Table<TData>
  /** Placeholder and accessible name of the search field. */
  searchPlaceholder: string
  filters?: { columnId: string; title: string; options: DataTableFilterOption[] }[]
}

/** Search (global filter), faceted filters, reset and column menu. */
export function DataTableToolbar<TData>({
  table,
  searchPlaceholder,
  filters = [],
}: DataTableToolbarProps<TData>) {
  const { t } = useTranslation('common')
  const state = table.getState()
  const globalFilter = typeof state.globalFilter === 'string' ? state.globalFilter : ''
  const isFiltered = state.columnFilters.length > 0 || globalFilter !== ''

  return (
    <div role="search" className="flex shrink-0 flex-wrap items-center gap-2">
      <Input
        type="search"
        placeholder={searchPlaceholder}
        aria-label={searchPlaceholder}
        value={globalFilter}
        onChange={(event) => {
          table.setGlobalFilter(event.target.value)
        }}
        className="h-8 w-full sm:w-62.5"
      />
      {filters.map((filter) => {
        const column = table.getColumn(filter.columnId)
        return column ? (
          <DataTableFacetedFilter
            key={filter.columnId}
            column={column}
            title={filter.title}
            options={filter.options}
          />
        ) : null
      })}
      {isFiltered ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 lg:px-3"
          onClick={() => {
            table.resetColumnFilters()
            table.setGlobalFilter('')
          }}
        >
          {t('table.reset')}
          <XIcon data-icon="inline-end" />
        </Button>
      ) : null}
      <DataTableViewOptions table={table} />
    </div>
  )
}
