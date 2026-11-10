import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { useViewer } from '@/entities/profile'
import { transitionQueries } from '@/entities/task'
import { useDocumentTitle } from '@/shared/lib'
import {
  Button,
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyTitle,
  PageHeader,
  toast,
} from '@/shared/ui'

import { useBoardUrlState } from '../model/use-board-url-state'
import { useMissingObjects } from '../model/use-missing-objects'
import { useTaskMove } from '../model/use-task-move'
import { BoardContent } from './board-content'
import { MoveLayer } from './move-layer'
import { ObjectFilter } from './object-filter'

const NO_RULES: never[] = []

/** Kanban board of tasks by status, for both roles; RLS decides which tasks are visible. */
export function BoardPage() {
  const { t } = useTranslation('board')
  useDocumentTitle(t('title'))
  const viewer = useViewer()
  const url = useBoardUrlState(viewer.role)
  const rules = useQuery(transitionQueries.all())
  const move = useTaskMove({ rules: rules.data ?? NO_RULES, viewer })
  const { objectIds } = url
  const { missingKey, allMissing } = useMissingObjects(objectIds)
  const { dropObjectIds } = url

  useEffect(() => {
    if (missingKey === '' || allMissing) return
    dropObjectIds(missingKey.split(','))
    toast(t('objectsDropped'))
  }, [missingKey, allMissing, dropObjectIds, t])

  return (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-6 fit-screen:min-h-0 fit-screen:flex-1">
      <PageHeader title={t('title')} description={t('description')} />
      <MoveLayer move={move} />
      {allMissing ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('objectNotFound')}</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                url.setObjectIds([])
              }}
            >
              {t('showAllObjects')}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <ObjectFilter value={objectIds} onChange={url.setObjectIds} />
          <BoardContent
            viewer={viewer}
            rules={rules}
            move={move}
            objectIds={objectIds}
            column={url.column}
            onColumnChange={url.setColumn}
            onResetFilter={() => {
              url.setObjectIds([])
            }}
          />
        </>
      )}
    </div>
  )
}
