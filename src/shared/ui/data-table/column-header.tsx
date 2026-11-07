/*
 * Adapted from shadcn-admin (https://github.com/satnaing/shadcn-admin),
 * Copyright (c) 2024 Sat Naing, MIT License. See THIRD_PARTY_NOTICES.md.
 */
import type { Column } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, EyeOffIcon } from 'lucide-react'

import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'

import { VIEW_OPTIONS_SELECTOR } from './view-options'

interface DataTableColumnHeaderProps<TData, TValue> {
  column: Column<TData, TValue>
  title: string
  className?: string
}

/** Header cell content: a plain title, or a sort menu when the column is sortable. */
export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  const { t } = useTranslation('common')
  if (!column.getCanSort()) {
    return <div className={cn(className)}>{title}</div>
  }
  const sorted = column.getIsSorted()
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="-ms-3 h-8 data-[state=open]:bg-accent"
            aria-label={t('table.sortBy', { title })}
          >
            <span>{title}</span>
            {sorted === 'desc' ? (
              <ArrowDownIcon data-icon="inline-end" />
            ) : sorted === 'asc' ? (
              <ArrowUpIcon data-icon="inline-end" />
            ) : (
              <ChevronsUpDownIcon data-icon="inline-end" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onSelect={() => {
              column.toggleSorting(false)
            }}
          >
            <ArrowUpIcon />
            {t('table.sortAsc')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              column.toggleSorting(true)
            }}
          >
            <ArrowDownIcon />
            {t('table.sortDesc')}
          </DropdownMenuItem>
          {column.getCanHide() ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  column.toggleVisibility(false)
                  // The header (and this menu) disappears: hand focus to the «Columns» button.
                  requestAnimationFrame(() => {
                    document.querySelector<HTMLElement>(VIEW_OPTIONS_SELECTOR)?.focus()
                  })
                }}
              >
                <EyeOffIcon />
                {t('table.hideColumn')}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
