/*
 * Adapted from shadcn-admin (https://github.com/satnaing/shadcn-admin),
 * Copyright (c) 2024 Sat Naing, MIT License. See THIRD_PARTY_NOTICES.md.
 */
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ListChecksIcon } from 'lucide-react'

import { TaskStatusBadge, useTaskStatusOptions, type MyTaskRow } from '@/entities/task'
import {
  formatDateTime,
  openedRowLink,
  useDataTable,
  useRestoreOpenedRow,
  type TableUrlState,
} from '@/shared/lib'
import {
  DataTable,
  DataTableColumnHeader,
  DataTablePagination,
  DataTableToolbar,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  textLinkClass,
  type DataTableColumnMeta,
} from '@/shared/ui'

const LIST_KEY = 'my-tasks'

interface MyTasksTableProps {
  urlState: TableUrlState
  search: string
  data: MyTaskRow[]
  total: number
  isLoading: boolean
}

/** The executor's tasks: the server pages, searches and sorts; workflow order by default (rework first). */
export function MyTasksTable({ urlState, search, data, total, isLoading }: MyTasksTableProps) {
  const { t } = useTranslation('my-tasks')
  const statusOptions = useTaskStatusOptions()

  const columns = useMemo<ColumnDef<MyTaskRow>[]>(
    () => [
      {
        accessorKey: 'title',
        enableHiding: false,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('columns.title')} />
        ),
        cell: ({ row }) => (
          <Link
            to={`/tasks/${row.original.id}`}
            {...openedRowLink(LIST_KEY, row.original.id)}
            className={textLinkClass}
            title={row.original.title}
          >
            <span className="line-clamp-2 [overflow-wrap:anywhere]">{row.original.title}</span>
          </Link>
        ),
        meta: {
          className: 'min-w-64 whitespace-normal',
          label: t('columns.title'),
        } satisfies DataTableColumnMeta,
      },
      {
        id: 'object',
        accessorFn: (row) => row.object.name,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('columns.object')} />
        ),
        cell: ({ row }) => (
          <Link
            to={`/objects/${row.original.object.id}`}
            className={textLinkClass}
            title={row.original.object.name}
          >
            <span className="line-clamp-2 [overflow-wrap:anywhere]">
              {row.original.object.name}
            </span>
          </Link>
        ),
        meta: {
          className: 'min-w-48 whitespace-normal',
          label: t('columns.object'),
        } satisfies DataTableColumnMeta,
      },
      {
        accessorKey: 'status',
        enableHiding: false,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('columns.status')} />
        ),
        cell: ({ row }) => <TaskStatusBadge status={row.original.status} />,
        meta: {
          className: 'whitespace-nowrap',
          label: t('columns.status'),
        } satisfies DataTableColumnMeta,
      },
      {
        accessorKey: 'created_at',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('columns.createdAt')} />
        ),
        cell: ({ row }) => (
          <time dateTime={row.original.created_at} className="whitespace-nowrap">
            {formatDateTime(row.original.created_at)}
          </time>
        ),
        meta: {
          className: 'whitespace-nowrap',
          label: t('columns.createdAt'),
        } satisfies DataTableColumnMeta,
      },
    ],
    [t],
  )

  const table = useDataTable({
    data,
    columns,
    rowCount: total,
    urlState,
    isLoading,
  })

  useRestoreOpenedRow(LIST_KEY, !isLoading)

  const isFiltered = search !== '' || urlState.statuses.length > 0
  const isEmpty = !isLoading && total === 0 && !isFiltered

  return (
    <div className="flex min-w-0 flex-col gap-4 fit-screen:min-h-0 fit-screen:flex-initial">
      {isEmpty ? null : (
        <DataTableToolbar
          table={table}
          searchPlaceholder={t('search')}
          filters={[{ columnId: 'status', title: t('filters.status'), options: statusOptions }]}
        />
      )}
      <DataTable
        table={table}
        label={t('table')}
        isLoading={isLoading}
        empty={
          <Empty className="p-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ListChecksIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>{isFiltered ? t('noResults') : t('empty')}</EmptyTitle>
              <EmptyDescription>
                {isFiltered ? t('noResultsHint') : t('emptyHint')}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
      />
      {isEmpty ? null : <DataTablePagination table={table} className="shrink-0" />}
    </div>
  )
}
