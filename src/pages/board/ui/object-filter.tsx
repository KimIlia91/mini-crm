import { useQueries, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DEFAULT_OBJECT_SORT, objectQueries } from '@/entities/object'
import { MAX_PAGE_SIZE } from '@/shared/api'
import { useDebouncedSearch } from '@/shared/lib'

import { MAX_BOARD_OBJECTS } from '../model/board'
import { ObjectCombobox } from './object-combobox'

const PAGE_STEP = 20

interface ObjectFilterProps {
  value: readonly string[]
  onChange: (objectIds: readonly string[]) => void
}

/**
 * Object filter of the board: several objects, server-side search (debounced) over the objects the
 * viewer can see, listed by the same query as the objects page; «Show more» grows the page up to
 * the page ceiling. Names of selected objects that are not in the loaded page come from their details.
 */
export function ObjectFilter({ value, onChange }: ObjectFilterProps) {
  const { t } = useTranslation('board')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(PAGE_STEP)
  const applied = useDebouncedSearch({ globalFilter: search })
  const list = useQuery(
    objectQueries.list({
      pageIndex: 0,
      pageSize: limit,
      search: applied,
      sort: DEFAULT_OBJECT_SORT,
    }),
  )
  const details = useQueries({ queries: value.map((id) => objectQueries.detail(id)) })

  const rows = list.data?.rows ?? []
  const total = list.data?.total
  const items = rows.map(({ id, name }) => ({ id, name }))
  const selected = value.flatMap((id, index) => {
    const name = details[index]?.data?.name ?? rows.find((row) => row.id === id)?.name
    return name === undefined ? [] : [{ id, name }]
  })
  const triggerLabel =
    value.length === 0
      ? t('filter.all')
      : value.length === 1 && selected[0] !== undefined
        ? selected[0].name
        : t('filter.selectedCount', { count: value.length })

  return (
    <ObjectCombobox
      label={t('filter.label')}
      value={value}
      triggerLabel={triggerLabel}
      selected={selected}
      items={items}
      search={search}
      onSearchChange={(next) => {
        setSearch(next)
        setLimit(PAGE_STEP)
      }}
      onToggle={(id) => {
        onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id])
      }}
      onClear={() => {
        onChange([])
      }}
      isLoading={list.isPending || applied !== search}
      isFetchingMore={list.isPlaceholderData}
      isError={list.isError}
      onRetry={() => {
        void list.refetch()
      }}
      hasMore={total !== undefined && rows.length < total && limit < MAX_PAGE_SIZE}
      onLoadMore={() => {
        setLimit((previous) => Math.min(previous + PAGE_STEP, MAX_PAGE_SIZE))
      }}
      total={total}
      maxSelected={MAX_BOARD_OBJECTS}
    />
  )
}
