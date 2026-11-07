/*
 * Adapted from shadcn-admin (https://github.com/satnaing/shadcn-admin),
 * Copyright (c) 2024 Sat Naing, MIT License. See THIRD_PARTY_NOTICES.md.
 */
import type { Table } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from 'lucide-react'

import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

export const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50] as const

/** Up to 7 entries around the current page; 0 stands for an ellipsis. */
function getPageNumbers(current: number, total: number): number[] {
  if (total <= 5) return Array.from({ length: total }, (_, index) => index + 1)
  if (current <= 3) return [1, 2, 3, 4, 0, total]
  if (current >= total - 2) return [1, 0, total - 3, total - 2, total - 1, total]
  return [1, 0, current - 1, current, current + 1, 0, total]
}

/** Pages offered by the mobile select: first, last and a window around the current page. */
const PAGE_SELECT_WINDOW = 10
function getSelectablePages(current: number, total: number): number[] {
  const pages = new Set([1, total])
  const from = Math.max(1, current - PAGE_SELECT_WINDOW)
  const to = Math.min(total, current + PAGE_SELECT_WINDOW)
  for (let page = from; page <= to; page++) pages.add(page)
  return [...pages].sort((a, b) => a - b)
}

/** Rows-per-page select, "Page X of Y" and first/previous/numbers/next/last buttons. */
export function DataTablePagination<TData>({
  table,
  className,
}: {
  table: Table<TData>
  className?: string
}) {
  const { t } = useTranslation('common')
  const { pageIndex, pageSize } = table.getState().pagination
  const current = pageIndex + 1
  const total = Math.max(table.getPageCount(), 1)

  return (
    <nav
      aria-label={t('table.pagination')}
      className={cn('flex flex-wrap items-center justify-between gap-x-6 gap-y-3', className)}
    >
      <div className="flex items-center gap-2">
        <span id="rows-per-page-label" className="text-sm font-medium">
          {t('table.rowsPerPage')}
        </span>
        <Select
          value={String(pageSize)}
          onValueChange={(value) => {
            table.setPageSize(Number(value))
          }}
        >
          <SelectTrigger size="sm" className="w-[4.5rem]" aria-labelledby="rows-per-page-label">
            <SelectValue />
          </SelectTrigger>
          <SelectContent side="top">
            {PAGE_SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-2 max-md:w-full">
        <span role="status" className="text-sm font-medium max-md:sr-only">
          {t('table.pageOf', { current, total })}
        </span>
        {/* Below md the page can be picked from a list instead of stepping with the arrows. */}
        <Select
          value={String(current)}
          onValueChange={(value) => {
            table.setPageIndex(Number(value) - 1)
          }}
        >
          <SelectTrigger
            size="sm"
            className="max-md:h-11 max-md:min-w-[min(7rem,100%)] max-md:flex-1 md:hidden"
            // A combobox takes its name from the author, not from its content: the visible short text («3 из 12») is part of it.
            aria-label={t('table.pageOf', { current, total })}
          >
            <SelectValue>{t('table.pageShort', { current, total })}</SelectValue>
          </SelectTrigger>
          <SelectContent
            position="popper"
            side="top"
            className="max-h-[min(18rem,var(--radix-select-content-available-height))]"
          >
            {getSelectablePages(current, total).map((page) => (
              <SelectItem key={page} value={String(page)}>
                {t('table.pageOf', { current: page, total })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon-sm"
          className="max-md:hidden"
          aria-label={t('table.firstPage')}
          disabled={!table.getCanPreviousPage()}
          onClick={() => {
            table.setPageIndex(0)
          }}
        >
          <ChevronsLeftIcon />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          className="max-md:size-11"
          aria-label={t('table.previousPage')}
          disabled={!table.getCanPreviousPage()}
          onClick={() => {
            table.previousPage()
          }}
        >
          <ChevronLeftIcon />
        </Button>
        {getPageNumbers(current, total).map((page, index) =>
          page === 0 ? (
            <span
              key={`gap-${String(index)}`}
              aria-hidden="true"
              className="px-1 text-sm max-md:hidden"
            >
              …
            </span>
          ) : (
            <Button
              key={page}
              variant={page === current ? 'default' : 'outline'}
              size="icon-sm"
              className="max-md:hidden"
              aria-label={t('table.pageNumber', { page })}
              aria-current={page === current ? 'page' : undefined}
              onClick={() => {
                table.setPageIndex(page - 1)
              }}
            >
              {page}
            </Button>
          ),
        )}
        <Button
          variant="outline"
          size="icon-sm"
          className="max-md:size-11"
          aria-label={t('table.nextPage')}
          disabled={!table.getCanNextPage()}
          onClick={() => {
            table.nextPage()
          }}
        >
          <ChevronRightIcon />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          className="max-md:hidden"
          aria-label={t('table.lastPage')}
          disabled={!table.getCanNextPage()}
          onClick={() => {
            table.setPageIndex(total - 1)
          }}
        >
          <ChevronsRightIcon />
        </Button>
      </div>
    </nav>
  )
}
