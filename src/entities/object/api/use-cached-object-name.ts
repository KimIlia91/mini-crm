import { useQueryClient } from '@tanstack/react-query'

import type { PageResult } from '@/shared/api'

import type { ObjectRow } from '../model/object'

import { objectKeys } from './object'

/**
 * Name of an object already present in any loaded page of the list. List rows are the same columns
 * as the detail, but the name is exposed alone: it is a breadcrumb label, not data for the page body.
 */
export function useCachedObjectName(id: string): string | undefined {
  const queryClient = useQueryClient()
  for (const [, page] of queryClient.getQueriesData<PageResult<ObjectRow>>({
    queryKey: objectKeys.lists(),
  })) {
    const row = page?.rows.find((o) => o.id === id)
    if (row) return row.name
  }
  return undefined
}
