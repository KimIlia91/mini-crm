import { keepPreviousData, queryOptions } from '@tanstack/react-query'

import {
  getSupabaseClient,
  ilikeContains,
  normalizeSearch,
  pageRange,
  quoteFilterValue,
  readPage,
  type PageResult,
} from '@/shared/api'

import type { ObjectListParams, ObjectRow } from '../model/object'

export const objectKeys = {
  all: ['objects'] as const,
  lists: () => [...objectKeys.all, 'list'] as const,
  list: (params: ObjectListParams) => [...objectKeys.lists(), params] as const,
  detail: (id: string) => [...objectKeys.all, 'detail', id] as const,
}

const COLUMNS = 'id, name, address, created_at'

export const objectQueries = {
  list: (params: ObjectListParams) => {
    const p = { ...params, search: normalizeSearch(params.search) }
    return queryOptions({
      queryKey: objectKeys.list(p),
      placeholderData: keepPreviousData,
      queryFn: ({ signal }): Promise<PageResult<ObjectRow>> => {
        const [from, to] = pageRange(p)
        const pattern = quoteFilterValue(ilikeContains(p.search))
        const filtered = (head: boolean) => {
          const query = getSupabaseClient()
            .from('objects')
            .select(COLUMNS, { count: 'exact', head })
          return p.search === ''
            ? query
            : query.or(`name.ilike.${pattern},address.ilike.${pattern}`)
        }
        const ascending = !p.sort.desc
        return readPage(
          () =>
            filtered(false)
              .order(p.sort.id, { ascending })
              .order('id', { ascending })
              .range(from, to)
              .abortSignal(signal)
              .overrideTypes<ObjectRow[], { merge: false }>(),
          () => filtered(true).abortSignal(signal),
        )
      },
    })
  },
  detail: (id: string) =>
    queryOptions({
      queryKey: objectKeys.detail(id),
      queryFn: async ({ signal }): Promise<ObjectRow | null> => {
        const { data, error } = await getSupabaseClient()
          .from('objects')
          .select(COLUMNS)
          .eq('id', id)
          .abortSignal(signal)
          .maybeSingle()
        if (error) throw error
        return data
      },
    }),
}
