import type { QueryExecuteOptions, QueryKey } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useEffectEvent } from 'react'

interface PrefetchAdjacentPages<TData, TKey extends QueryKey> {
  pageIndex: number
  pageCount: number
  isReady: boolean
  optionsFor: (pageIndex: number) => QueryExecuteOptions<TData, Error, TData, TData, TKey>
}

/**
 * Quietly loads the pages next to the shown one so that paging back and forth is instant.
 * Nothing is requested before the shown page arrives or beyond the first/last page.
 */
export function usePrefetchAdjacentPages<TData, TKey extends QueryKey>({
  pageIndex,
  pageCount,
  isReady,
  optionsFor,
}: PrefetchAdjacentPages<TData, TKey>): void {
  const queryClient = useQueryClient()
  const prefetch = useEffectEvent((index: number) => {
    queryClient.query(optionsFor(index)).catch(() => undefined)
  })
  useEffect(() => {
    if (!isReady) return
    if (pageIndex + 1 < pageCount) prefetch(pageIndex + 1)
    if (pageIndex - 1 >= 0 && pageIndex - 1 < pageCount) prefetch(pageIndex - 1)
  }, [isReady, pageIndex, pageCount])
}
