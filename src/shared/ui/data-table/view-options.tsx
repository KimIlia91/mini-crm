/*
 * Adapted from shadcn-admin (https://github.com/satnaing/shadcn-admin),
 * Copyright (c) 2024 Sat Naing, MIT License. See THIRD_PARTY_NOTICES.md.
 */
import type { Table } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { SlidersHorizontalIcon } from 'lucide-react'

import { Button } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'

import type { DataTableColumnMeta } from './meta'

function labelOf(meta: DataTableColumnMeta | undefined, fallback: string): string {
  return meta?.label ?? fallback
}

/** Marks the trigger so a header menu can hand focus over after it hides its own column. */
export const VIEW_OPTIONS_SELECTOR = '[data-slot="data-table-view-options"]'

/**
 * Menu to show hidden columns again (and hide others). Rendered automatically when the table has a
 * hideable column (`enableHiding: false` opts a key column out), on every screen width.
 */
export function DataTableViewOptions<TData>({ table }: { table: Table<TData> }) {
  const { t } = useTranslation('common')
  const columns = table.getAllColumns().filter((column) => column.getCanHide())
  if (columns.length === 0) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          data-slot="data-table-view-options"
          variant="outline"
          size="sm"
          className="ms-auto h-8"
        >
          <SlidersHorizontalIcon data-icon="inline-start" />
          {t('table.columns')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuLabel>{t('table.showColumns')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={column.getIsVisible()}
            onSelect={(event) => {
              event.preventDefault()
            }}
            onCheckedChange={(value) => {
              column.toggleVisibility(value)
            }}
          >
            {labelOf(column.columnDef.meta, column.id)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
