/*
 * Adapted from shadcn-admin (https://github.com/satnaing/shadcn-admin),
 * Copyright (c) 2024 Sat Naing, MIT License. See THIRD_PARTY_NOTICES.md.
 */
import type { Column } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { PlusCircleIcon } from 'lucide-react'

import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'

export interface DataTableFilterOption {
  label: string
  value: string
  icon?: React.ComponentType<{ className?: string }>
}

interface DataTableFacetedFilterProps<TData, TValue> {
  column: Column<TData, TValue>
  title: string
  options: DataTableFilterOption[]
}

/**
 * Multi-select filter (the server filters; counts per option would be false, so there are none). Built on a menu with checkbox items, so it is operable with the keyboard
 * (arrows, Space/Enter, Esc) and every option is announced as a checkbox with its state.
 * The trigger's accessible name carries the selected count.
 */
export function DataTableFacetedFilter<TData, TValue>({
  column,
  title,
  options,
}: DataTableFacetedFilterProps<TData, TValue>) {
  const { t } = useTranslation('common')
  const selected = new Set(column.getFilterValue() as string[] | undefined)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 border-dashed">
          <PlusCircleIcon data-icon="inline-start" />
          {selected.size > 0 ? (
            <>
              <span aria-hidden="true">{title}</span>
              <Badge variant="secondary" className="rounded-sm px-1 font-normal" aria-hidden="true">
                {selected.size}
              </Badge>
              {/* Same words as shown, in one piece: «Статус: выбрано 2». */}
              <span className="sr-only">
                {t('table.filterSelected', { title, selected: selected.size })}
              </span>
            </>
          ) : (
            title
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuLabel>{title}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={selected.has(option.value)}
            // Keep the menu open so several options can be toggled in a row.
            onSelect={(event) => {
              event.preventDefault()
            }}
            onCheckedChange={(checked) => {
              const next = new Set(selected)
              if (checked) next.add(option.value)
              else next.delete(option.value)
              column.setFilterValue(next.size > 0 ? Array.from(next) : undefined)
            }}
          >
            {option.icon ? <option.icon className="text-muted-foreground" /> : null}
            <span>{option.label}</span>
          </DropdownMenuCheckboxItem>
        ))}
        {selected.size > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={false}
              className="justify-center text-center"
              onSelect={() => {
                column.setFilterValue(undefined)
              }}
            >
              {t('table.resetFilter')}
            </DropdownMenuCheckboxItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
