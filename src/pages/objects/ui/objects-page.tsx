import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import type { SortingState } from '@tanstack/react-table'

import {
  DEFAULT_OBJECT_SORT,
  OBJECT_SORT_IDS,
  objectQueries,
  pickObjectSort,
} from '@/entities/object'
import { useViewer } from '@/entities/profile'
import { ObjectFormDialog } from '@/features/manage-object'
import {
  useDebouncedSearch,
  useDocumentTitle,
  usePrefetchAdjacentPages,
  useTableUrlState,
} from '@/shared/lib'
import { Alert, AlertDescription, Button, PAGE_SIZE_OPTIONS, PageHeader } from '@/shared/ui'

import { ObjectsTable } from './objects-table'

const NO_OBJECTS: never[] = []
const LIST_KEY = 'objects'
const DEFAULT_SORTING: SortingState = [DEFAULT_OBJECT_SORT]

export function ObjectsPage() {
  const { t } = useTranslation('objects')
  useDocumentTitle(t('title'))
  const { role } = useViewer()
  const isManager = role === 'manager'
  const urlState = useTableUrlState({
    pageSizes: PAGE_SIZE_OPTIONS,
    sortableIds: OBJECT_SORT_IDS,
    defaultSorting: DEFAULT_SORTING,
    listKey: LIST_KEY,
  })
  const search = useDebouncedSearch(urlState)
  const listOptions = (pageIndex: number) =>
    objectQueries.list({
      pageIndex,
      pageSize: urlState.pagination.pageSize,
      search,
      sort: pickObjectSort(urlState.sorting[0]),
    })
  const query = useQuery(listOptions(urlState.pagination.pageIndex))
  usePrefetchAdjacentPages({
    pageIndex: urlState.pagination.pageIndex,
    pageCount: Math.ceil((query.data?.total ?? 0) / urlState.pagination.pageSize),
    isReady: query.isSuccess && !query.isPlaceholderData,
    optionsFor: listOptions,
  })

  return (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-6 fit-screen:min-h-0 fit-screen:flex-1">
      <PageHeader
        title={t('title')}
        description={isManager ? t('descriptionManager') : t('descriptionExecutor')}
        actions={isManager ? <ObjectFormDialog trigger={<Button>{t('add')}</Button>} /> : null}
      />
      {query.isError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            {t('loadError')}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void query.refetch()
              }}
            >
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <ObjectsTable
          search={search}
          urlState={urlState}
          data={query.data?.rows ?? NO_OBJECTS}
          total={query.data?.total ?? 0}
          isLoading={query.isPending || query.isPlaceholderData}
          isManager={isManager}
        />
      )}
    </div>
  )
}
