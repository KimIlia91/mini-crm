/*
 * Adapted from shadcn-admin (https://github.com/satnaing/shadcn-admin),
 * Copyright (c) 2024 Sat Naing, MIT License. See THIRD_PARTY_NOTICES.md.
 */
import type { SortingState } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'

import { objectQueries } from '@/entities/object'
import { useViewer } from '@/entities/profile'
import {
  DEFAULT_TASK_SORT,
  OBJECT_TASK_SORT_IDS,
  pickObjectTaskSort,
  pickStatuses,
  TASK_STATUS_ORDER,
  taskQueries,
} from '@/entities/task'
import { DeleteObjectButton, ObjectFormDialog } from '@/features/manage-object'
import { TaskFormDialog } from '@/features/manage-task'
import {
  useDebouncedSearch,
  useDocumentTitle,
  usePrefetchAdjacentPages,
  useReturnFocus,
  useTableUrlState,
} from '@/shared/lib'
import {
  ActionsMenu,
  Alert,
  AlertDescription,
  Button,
  PAGE_SIZE_OPTIONS,
  PageHeader,
  PageLoader,
} from '@/shared/ui'

import { ObjectTasksTable } from './object-tasks-table'

const NO_TASKS: never[] = []
const DEFAULT_SORTING: SortingState = [DEFAULT_TASK_SORT]

function RetryAlert({ text, onRetry }: { text: string; onRetry: () => void }) {
  const { t } = useTranslation('object')
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription className="flex flex-wrap items-center gap-2">
        {text}
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t('retry')}
        </Button>
      </AlertDescription>
    </Alert>
  )
}

function ObjectNotFound() {
  const { t } = useTranslation('object')
  useDocumentTitle(t('notFoundTitle'))
  return (
    <section className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <p aria-hidden="true" className="text-[7rem] leading-tight font-bold">
        {t('notFoundCode')}
      </p>
      <h1 className="text-2xl font-medium [overflow-wrap:anywhere]">{t('notFoundTitle')}</h1>
      <p className="text-muted-foreground">{t('notFoundDescription')}</p>
      <Button asChild className="mt-6">
        <Link to="/">{t('home')}</Link>
      </Button>
    </section>
  )
}

export function ObjectPage() {
  const { t } = useTranslation('object')
  const { objectId = '' } = useParams()
  const viewer = useViewer()
  const navigate = useNavigate()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const { remember, onCloseAutoFocus } = useReturnFocus()
  const object = useQuery({ ...objectQueries.detail(objectId), enabled: objectId !== '' })
  const urlState = useTableUrlState({
    pageSizes: PAGE_SIZE_OPTIONS,
    statusValues: TASK_STATUS_ORDER,
    sortableIds: OBJECT_TASK_SORT_IDS,
    defaultSorting: DEFAULT_SORTING,
    listKey: `object:${objectId}`,
  })
  const search = useDebouncedSearch(urlState)
  const tasksOptions = (pageIndex: number) =>
    taskQueries.byObject(objectId, {
      pageIndex,
      pageSize: urlState.pagination.pageSize,
      search,
      sort: pickObjectTaskSort(urlState.sorting[0]),
      statuses: pickStatuses(urlState.statuses),
    })
  const tasks = useQuery({
    ...tasksOptions(urlState.pagination.pageIndex),
    enabled: objectId !== '',
  })
  usePrefetchAdjacentPages({
    pageIndex: urlState.pagination.pageIndex,
    pageCount: Math.ceil((tasks.data?.total ?? 0) / urlState.pagination.pageSize),
    isReady: tasks.isSuccess && !tasks.isPlaceholderData,
    optionsFor: tasksOptions,
  })
  useDocumentTitle(object.data?.name ?? '')

  if (object.isPending) {
    return <PageLoader />
  }
  if (object.isError) {
    return (
      <RetryAlert
        text={t('loadError')}
        onRetry={() => {
          void object.refetch()
        }}
      />
    )
  }
  if (!object.data) return <ObjectNotFound />

  const data = object.data
  const isManager = viewer.role === 'manager'

  return (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-6 fit-screen:min-h-0 fit-screen:flex-1">
      <PageHeader
        title={data.name}
        description={data.address}
        clamp
        actions={
          isManager ? (
            <ActionsMenu
              label={t('actions')}
              editLabel={t('edit')}
              deleteLabel={t('delete')}
              onEdit={(opener) => {
                remember(opener)
                setEditOpen(true)
              }}
              onDelete={(opener) => {
                remember(opener)
                setDeleteOpen(true)
              }}
            />
          ) : null
        }
      />
      <section
        aria-labelledby="object-tasks-title"
        className="flex min-w-0 flex-col gap-4 fit-screen:min-h-0 fit-screen:flex-initial"
      >
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 id="object-tasks-title" className="min-w-0 text-lg font-semibold">
            {t('tasks')}
          </h2>
          {isManager ? <TaskFormDialog mode="create" objectId={data.id} /> : null}
        </div>
        {tasks.isError ? (
          <RetryAlert
            text={t('tasksLoadError')}
            onRetry={() => {
              void tasks.refetch()
            }}
          />
        ) : (
          <ObjectTasksTable
            search={search}
            objectId={data.id}
            urlState={urlState}
            data={tasks.data?.rows ?? NO_TASKS}
            total={tasks.data?.total ?? 0}
            isLoading={tasks.isPending || tasks.isPlaceholderData}
            canManage={isManager}
          />
        )}
      </section>
      {isManager ? (
        <>
          <ObjectFormDialog
            object={data}
            open={editOpen}
            onOpenChange={setEditOpen}
            onCloseAutoFocus={onCloseAutoFocus}
          />
          <DeleteObjectButton
            object={data}
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            onCloseAutoFocus={onCloseAutoFocus}
            onDeleted={() => {
              void navigate('/objects')
            }}
          />
        </>
      ) : null}
    </div>
  )
}
