import { useQueryClient } from '@tanstack/react-query'

import type { PageResult } from '@/shared/api'

import { taskKeys } from './task'

interface TitledRow {
  id: string
  title: string
}

/**
 * Title of a task already present in any loaded page of a task list (by object / mine). List rows
 * are narrower than the detail, so only the title is exposed — for breadcrumbs, not for the page body.
 */
export function useCachedTaskTitle(id: string): string | undefined {
  const queryClient = useQueryClient()
  for (const [, page] of queryClient.getQueriesData<PageResult<TitledRow>>({
    queryKey: taskKeys.lists(),
  })) {
    const row = page?.rows.find((r) => r.id === id)
    if (row) return row.title
  }
  return undefined
}
