import type { SortingState } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { useViewer } from '@/entities/profile'
import {
  DEFAULT_TASK_SORT,
  MY_TASK_SORT_IDS,
  pickMyTaskSort,
  pickStatuses,
  TASK_STATUS_ORDER,
  taskQueries,
} from '@/entities/task'
import {
  useDebouncedSearch,
  useDocumentTitle,
  usePrefetchAdjacentPages,
  useTableUrlState,
} from '@/shared/lib'
import { Alert, AlertDescription, Button, PAGE_SIZE_OPTIONS, PageHeader } from '@/shared/ui'

import { MyTasksTable } from './my-tasks-table'

const NO_TASKS: never[] = []
const LIST_KEY = 'my-tasks'
const DEFAULT_SORTING: SortingState = [DEFAULT_TASK_SORT]

export function MyTasksPage() {
  const { t } = useTranslation('my-tasks')
  useDocumentTitle(t('title'))
  const viewer = useViewer()
  const urlState = useTableUrlState({
    pageSizes: PAGE_SIZE_OPTIONS,
    statusValues: TASK_STATUS_ORDER,
    sortableIds: MY_TASK_SORT_IDS,
    defaultSorting: DEFAULT_SORTING,
    listKey: LIST_KEY,
  })
  const search = useDebouncedSearch(urlState)
  const listOptions = (pageIndex: number) =>
    taskQueries.mine(viewer.id, {
      pageIndex,
      pageSize: urlState.pagination.pageSize,
      search,
      sort: pickMyTaskSort(urlState.sorting[0]),
      statuses: pickStatuses(urlState.statuses),
    })
  const tasks = useQuery(listOptions(urlState.pagination.pageIndex))
  usePrefetchAdjacentPages({
    pageIndex: urlState.pagination.pageIndex,
    pageCount: Math.ceil((tasks.data?.total ?? 0) / urlState.pagination.pageSize),
    isReady: tasks.isSuccess && !tasks.isPlaceholderData,
    optionsFor: listOptions,
  })

  return (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-6 fit-screen:min-h-0 fit-screen:flex-1">
      <PageHeader title={t('title')} description={t('description')} />
      {tasks.isError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            {t('loadError')}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void tasks.refetch()
              }}
            >
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <MyTasksTable
          search={search}
          urlState={urlState}
          data={tasks.data?.rows ?? NO_TASKS}
          total={tasks.data?.total ?? 0}
          isLoading={tasks.isPending || tasks.isPlaceholderData}
        />
      )}
    </div>
  )
}
