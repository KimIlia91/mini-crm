/*
 * Adapted from shadcn-admin (https://github.com/satnaing/shadcn-admin),
 * Copyright (c) 2024 Sat Naing, MIT License. See THIRD_PARTY_NOTICES.md.
 */
import type { ColumnDef } from '@tanstack/react-table'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Building2Icon } from 'lucide-react'

import type { ObjectRow } from '@/entities/object'
import { DeleteObjectButton, ObjectFormDialog } from '@/features/manage-object'
import {
  openedRowLink,
  useDataTable,
  useRestoreOpenedRow,
  useReturnFocus,
  type TableUrlState,
} from '@/shared/lib'
import {
  ActionsMenu,
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

interface ObjectsTableProps {
  urlState: TableUrlState
  search: string
  data: ObjectRow[]
  total: number
  isLoading: boolean
  isManager: boolean
}

const LIST_KEY = 'objects'
const ACTIONS_META: DataTableColumnMeta = { className: 'w-px whitespace-nowrap' }

/** Objects as a table: search, sort and pagination are done by the server (state in the URL); row menu for managers. */
export function ObjectsTable({
  urlState,
  search,
  data,
  total,
  isLoading,
  isManager,
}: ObjectsTableProps) {
  const { t } = useTranslation('objects')
  const [target, setTarget] = useState<ObjectRow | null>(null)
  const [open, setOpen] = useState<'edit' | 'delete' | null>(null)
  const { remember, onCloseAutoFocus } = useReturnFocus()
  const openEdit = useCallback(
    (object: ObjectRow, opener: HTMLElement | null) => {
      remember(opener)
      setTarget(object)
      setOpen('edit')
    },
    [remember],
  )
  const openDelete = useCallback(
    (object: ObjectRow, opener: HTMLElement | null) => {
      remember(opener)
      setTarget(object)
      setOpen('delete')
    },
    [remember],
  )

  const columns = useMemo<ColumnDef<ObjectRow>[]>(() => {
    const base: ColumnDef<ObjectRow>[] = [
      {
        accessorKey: 'name',
        enableHiding: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('columns.name')} />,
        cell: ({ row }) => (
          <Link
            to={`/objects/${row.original.id}`}
            {...openedRowLink(LIST_KEY, row.original.id)}
            className={textLinkClass}
            title={row.original.name}
          >
            <span className="line-clamp-2 [overflow-wrap:anywhere]">{row.original.name}</span>
          </Link>
        ),
        meta: {
          className: 'min-w-64 whitespace-normal',
          label: t('columns.name'),
        } satisfies DataTableColumnMeta,
      },
      {
        accessorKey: 'address',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('columns.address')} />
        ),
        cell: ({ row }) => (
          <span
            className="line-clamp-2 [overflow-wrap:anywhere] text-muted-foreground"
            title={row.original.address}
          >
            {row.original.address}
          </span>
        ),
        meta: {
          className: 'min-w-64 whitespace-normal',
          label: t('columns.address'),
        } satisfies DataTableColumnMeta,
      },
    ]
    if (!isManager) return base
    return [
      ...base,
      {
        id: 'actions',
        enableSorting: false,
        enableHiding: false,
        header: () => <span className="sr-only">{t('columns.actions')}</span>,
        cell: ({ row }) => (
          <ActionsMenu
            appearance="ghost"
            label={t('rowActions', { name: row.original.name })}
            editLabel={t('edit')}
            deleteLabel={t('delete')}
            onEdit={(opener) => {
              openEdit(row.original, opener)
            }}
            onDelete={(opener) => {
              openDelete(row.original, opener)
            }}
          />
        ),
        meta: ACTIONS_META,
      },
    ]
  }, [t, isManager, openEdit, openDelete])

  const table = useDataTable({
    data,
    columns,
    rowCount: total,
    urlState,
    isLoading,
  })
  useRestoreOpenedRow(LIST_KEY, !isLoading)

  const isFiltered = search !== ''
  const isEmpty = !isLoading && total === 0 && !isFiltered

  return (
    <div className="flex min-w-0 flex-col gap-4 fit-screen:min-h-0 fit-screen:flex-initial">
      {isEmpty ? null : <DataTableToolbar table={table} searchPlaceholder={t('search')} />}
      <DataTable
        table={table}
        label={t('table')}
        isLoading={isLoading}
        empty={
          <Empty className="p-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Building2Icon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>
                {isFiltered ? t('noResults') : isManager ? t('emptyManager') : t('emptyExecutor')}
              </EmptyTitle>
              <EmptyDescription>
                {isFiltered
                  ? t('noResultsHint')
                  : isManager
                    ? t('emptyManagerHint')
                    : t('emptyExecutorHint')}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
      />
      {isEmpty ? null : <DataTablePagination table={table} className="shrink-0" />}
      {target ? (
        <>
          <ObjectFormDialog
            key={`edit-${target.id}`}
            object={target}
            open={open === 'edit'}
            onCloseAutoFocus={onCloseAutoFocus}
            onOpenChange={(next) => {
              if (!next) setOpen(null)
            }}
          />
          <DeleteObjectButton
            key={`delete-${target.id}`}
            object={target}
            open={open === 'delete'}
            onCloseAutoFocus={onCloseAutoFocus}
            onOpenChange={(next) => {
              if (!next) setOpen(null)
            }}
          />
        </>
      ) : null}
    </div>
  )
}
