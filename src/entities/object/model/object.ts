import type { Database, ListSort, PageWindow } from '@/shared/api'

/** The columns the UI reads (soft-delete bookkeeping stays server-side). */
export type ObjectRow = Pick<
  Database['public']['Tables']['objects']['Row'],
  'id' | 'name' | 'address' | 'created_at'
>

/** Columns the objects list may be sorted by — the only source of the allowed `sort` ids. */
export const OBJECT_SORT_IDS = ['name', 'address'] as const
export type ObjectSortId = (typeof OBJECT_SORT_IDS)[number]

export const DEFAULT_OBJECT_SORT: ListSort<ObjectSortId> = { id: 'name', desc: false }

/** Narrows a sort coming from the URL to the allowlist; anything else is the default. */
export function pickObjectSort(sort: ListSort | undefined): ListSort<ObjectSortId> {
  const id = OBJECT_SORT_IDS.find((candidate) => candidate === sort?.id)
  return id === undefined || sort === undefined ? DEFAULT_OBJECT_SORT : { id, desc: sort.desc }
}

export interface ObjectListParams extends PageWindow {
  search: string
  sort: ListSort<ObjectSortId>
}
