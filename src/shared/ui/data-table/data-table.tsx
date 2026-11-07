/*
 * Adapted from shadcn-admin (https://github.com/satnaing/shadcn-admin),
 * Copyright (c) 2024 Sat Naing, MIT License. See THIRD_PARTY_NOTICES.md.
 */
import { motion, useReducedMotion } from 'motion/react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { flexRender, type Table as TanstackTable } from '@tanstack/react-table'

import { cn, useDelayedFlag } from '@/shared/lib'
import { Skeleton } from '@/shared/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'

import { useBodyPhase, type BodyPhase } from './body-phase'
import type { DataTableColumnMeta } from './meta'

const MotionTableBody = motion.create(TableBody)
const FADE_SECONDS = 0.2
const DEFAULT_SKELETON_ROWS = 5

interface DataTableProps<TData> {
  table: TanstackTable<TData>
  /** Accessible name of the table. */
  label: string
  /**
   * The rows for the current state are not there yet. The previous rows stay until a short delay has
   * passed (a fast answer never flashes a skeleton), then skeleton rows of the final row height
   * replace them with a fade.
   */
  isLoading?: boolean
  /** Rendered in a single cell when no rows match (e.g. an `Empty` block). */
  empty: React.ReactNode
}

function metaOf(meta: DataTableColumnMeta | undefined): DataTableColumnMeta {
  return meta ?? {}
}

/**
 * Table markup for a TanStack `table`: bordered wrapper that scrolls inside itself (horizontally; on a
 * roomy screen, inside a bounded parent, vertically too, with a sticky header),
 * `th scope="col"` with `aria-sort`, skeleton and empty rows. Truncating cells must set `title`.
 */
export function DataTable<TData>({
  table,
  label,
  isLoading = false,
  empty,
}: DataTableProps<TData>) {
  const { t } = useTranslation('common')
  const rows = table.getRowModel().rows
  const columns = table.getVisibleLeafColumns()
  const reduce = useReducedMotion() === true

  const skeletonDue = useDelayedFlag(isLoading)
  const [loadedOnce, setLoadedOnce] = useState(!isLoading)
  if (!isLoading && !loadedOnce) setLoadedOnce(true)
  let phase: BodyPhase = 'data'
  if (skeletonDue) phase = 'skeleton'
  else if (isLoading && rows.length === 0 && !loadedOnce) phase = 'hold'
  const { shown, opacity, onFadeEnd } = useBodyPhase(phase)

  // The skeleton has as many rows as the page it replaces, so the table keeps its height.
  const [rowCount, setRowCount] = useState(0)
  if (shown === 'data' && rows.length > 0 && rowCount !== rows.length) setRowCount(rows.length)
  // Skeleton rows are as tall as the real ones were (the average of the rows on screen), so the
  // table and everything under it keep their place. Written straight to the DOM, no re-render.
  const wrapper = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLTableSectionElement>(null)
  useLayoutEffect(() => {
    if (shown !== 'data' || rows.length === 0 || !wrapper.current || !body.current) return
    const average = body.current.getBoundingClientRect().height / rows.length
    wrapper.current.style.setProperty('--data-row-h', `${String(average)}px`)
  })
  const skeletonRows =
    rowCount > 0 ? rowCount : Math.min(table.getState().pagination.pageSize, DEFAULT_SKELETON_ROWS)

  return (
    <div
      ref={wrapper}
      className="flex min-h-0 flex-col rounded-md border fit-screen:min-h-22 fit-screen:flex-initial"
    >
      <span role="status" className="sr-only">
        {skeletonDue ? t('loading') : ''}
      </span>
      <Table
        aria-label={label}
        aria-busy={isLoading || undefined}
        containerClassName="min-h-0 scroll-pt-10 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50 fit-screen:flex-auto fit-screen:overflow-auto"
        containerProps={{
          tabIndex: 0,
          // A focused control that is only partly visible (a header button in a column beyond the
          // edge) is scrolled fully into view.
          onFocus: (event) => {
            if (event.target instanceof HTMLElement) {
              event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
            }
          },
          role: 'region',
          'aria-label': t('table.scrollArea', { label }),
        }}
      >
        <TableHeader className="sticky top-0 z-10 bg-background shadow-[inset_0_-1px_0_var(--border)] [&_tr]:border-b-0">
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted()
                return (
                  <TableHead
                    key={header.id}
                    scope="col"
                    colSpan={header.colSpan}
                    aria-sort={
                      header.column.getCanSort()
                        ? sorted === 'asc'
                          ? 'ascending'
                          : sorted === 'desc'
                            ? 'descending'
                            : 'none'
                        : undefined
                    }
                    className={cn(metaOf(header.column.columnDef.meta).className)}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <MotionTableBody
          ref={body}
          initial={false}
          animate={{ opacity }}
          transition={{ duration: reduce ? 0 : FADE_SECONDS, ease: 'easeOut' }}
          onAnimationComplete={onFadeEnd}
        >
          {shown !== 'data' ? (
            Array.from({ length: skeletonRows }, (_, index) => (
              <TableRow
                key={index}
                className="hover:bg-transparent"
                style={{ height: 'var(--data-row-h, 2.75rem)' }}
              >
                {columns.map((column) => (
                  <TableCell
                    key={column.id}
                    className={cn(metaOf(column.columnDef.meta).className)}
                  >
                    <Skeleton className="h-6 w-full max-w-48" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : rows.length > 0 ? (
            rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cn(metaOf(cell.column.columnDef.meta).className)}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="p-0">
                {empty}
              </TableCell>
            </TableRow>
          )}
        </MotionTableBody>
      </Table>
    </div>
  )
}
