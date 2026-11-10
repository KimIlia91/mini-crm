import { cn } from 'cn'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckIcon, ChevronsUpDownIcon, XIcon } from 'lucide-react'

import {
  Button,
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Spinner,
} from '@/shared/ui'

interface ObjectComboboxItem {
  id: string
  name: string
}

interface ObjectComboboxProps {
  id?: string
  label: string
  value: readonly string[]
  triggerLabel: string
  selected: readonly ObjectComboboxItem[]
  items: readonly ObjectComboboxItem[]
  search: string
  onSearchChange: (value: string) => void
  onToggle: (id: string) => void
  onClear: () => void
  isLoading: boolean
  isFetchingMore: boolean
  isError: boolean
  onRetry: () => void
  hasMore: boolean
  onLoadMore: () => void
  total?: number
  maxSelected: number
}

const ITEM_CLASS = 'min-h-11 cursor-pointer sm:min-h-8'

/** The full text goes to `title` only while it is actually cut off. */
function TruncatedText({ text, className }: { text: string; className?: string }) {
  return (
    <span
      ref={(node) => {
        if (!node) return
        if (node.scrollWidth > node.clientWidth) node.title = text
        else node.removeAttribute('title')
      }}
      className={cn('min-w-0 truncate', className)}
    >
      {text}
    </span>
  )
}

function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-sm border border-muted-foreground',
        checked && 'border-primary bg-primary text-primary-foreground',
      )}
    >
      {checked ? <CheckIcon className="size-3 text-primary-foreground!" /> : null}
    </span>
  )
}

/**
 * Multi-select object filter: a popover with server-side search that stays open while toggling.
 * Its width is bounded, long names are cut with a title, selected ones are removable chips.
 */
export function ObjectCombobox({
  id = 'board-object-filter',
  label,
  value,
  triggerLabel,
  selected,
  items,
  search,
  onSearchChange,
  onToggle,
  onClear,
  isLoading,
  isFetchingMore,
  isError,
  onRetry,
  hasMore,
  onLoadMore,
  total,
  maxSelected,
}: ObjectComboboxProps) {
  const { t } = useTranslation('board')
  const [open, setOpen] = useState(false)

  const shownLabel = triggerLabel === '' ? t('filter.all') : triggerLabel
  const isLimitReached = value.length >= maxSelected
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null)
  const canAutoLoad = hasMore && !isFetchingMore && !isError && open

  useEffect(() => {
    if (!canAutoLoad || !sentinel) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadMore()
    })
    observer.observe(sentinel)
    return () => {
      observer.disconnect()
    }
  }, [sentinel, canAutoLoad, items.length, onLoadMore])

  const isEmpty = !isLoading && !isError && items.length === 0 && search.trim() !== ''

  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:max-w-xl">
      <Label id={`${id}-label`} htmlFor={id}>
        {label}
      </Label>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) onSearchChange('')
        }}
      >
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-labelledby={`${id}-label ${id}`}
            className="h-11 w-full justify-between gap-2 px-3 font-normal sm:h-9 sm:w-72"
          >
            <TruncatedText text={shownLabel} className="flex-1 text-left" />
            <ChevronsUpDownIcon aria-hidden="true" className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="max-h-(--radix-popover-content-available-height) w-[min(var(--radix-popover-trigger-width),calc(100vw-2rem))] min-w-64 gap-0 p-0"
        >
          <Command
            shouldFilter={false}
            className="min-h-0 flex-1 rounded-md!"
            onValueChange={(active) => {
              if (canAutoLoad && active === items.at(-1)?.id) onLoadMore()
            }}
          >
            <CommandInput
              value={search}
              onValueChange={onSearchChange}
              placeholder={t('filter.search')}
              aria-label={t('filter.search')}
            />
            <CommandList className="max-h-80 min-h-0 flex-1">
              <CommandGroup>
                <CommandItem value="all" className={ITEM_CLASS} onSelect={onClear}>
                  <CheckBox checked={value.length === 0} />
                  <TruncatedText text={t('filter.all')} className="flex-1" />
                  {value.length === 0 ? (
                    <span className="sr-only">{t('filter.selectedMark')}</span>
                  ) : null}
                </CommandItem>
                {items.map((item) => {
                  const isSelected = value.includes(item.id)
                  return (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      disabled={isLimitReached && !isSelected}
                      className={ITEM_CLASS}
                      onSelect={() => {
                        onToggle(item.id)
                      }}
                    >
                      <CheckBox checked={isSelected} />
                      <TruncatedText text={item.name} className="flex-1" />
                      {isSelected ? (
                        <span className="sr-only">{t('filter.selectedMark')}</span>
                      ) : null}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
              {hasMore && !isError ? (
                <div ref={setSentinel} aria-hidden="true" className="h-px" />
              ) : null}
            </CommandList>
            {isFetchingMore ? (
              <div
                role="status"
                className="flex items-center justify-center gap-2 px-2 py-3 text-sm text-muted-foreground"
              >
                <Spinner aria-hidden="true" role="presentation" />
                {t('filter.loadingMore')}
              </div>
            ) : null}
            {isLoading ? (
              <div className="flex flex-col gap-1 p-2" role="status" aria-label={t('loading')}>
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
              </div>
            ) : null}
            {isEmpty ? (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                {t('filter.empty')}
              </p>
            ) : null}
            {isError ? (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-2 px-2 py-3 text-sm text-destructive"
              >
                {t('filter.loadError')}
                <Button type="button" size="sm" variant="outline" onClick={onRetry}>
                  {t('retry')}
                </Button>
              </div>
            ) : null}
            {hasMore ? (
              <div className="flex items-center justify-between gap-2 border-t px-3 py-1 text-xs text-muted-foreground">
                <span>
                  {total === undefined ? '' : t('filter.moreCount', { shown: items.length, total })}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isFetchingMore}
                  aria-busy={isFetchingMore}
                  onClick={onLoadMore}
                  className="h-11 text-xs sm:h-7"
                >
                  {isFetchingMore ? <Spinner aria-hidden="true" role="presentation" /> : null}
                  {t('filter.loadMore')}
                </Button>
              </div>
            ) : null}
            {isLimitReached ? (
              <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                {t('filter.limit', { count: maxSelected })}
              </p>
            ) : null}
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length > 0 ? (
        <ul aria-label={t('filter.selectedList')} className="flex flex-wrap gap-1.5">
          {selected.map((item) => (
            <li key={item.id} className="flex max-w-full min-w-0">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                aria-label={t('filter.remove', { name: item.name })}
                onClick={() => {
                  onToggle(item.id)
                }}
                className="h-11 max-w-full gap-1.5 sm:h-7"
              >
                <TruncatedText text={item.name} />
                <XIcon aria-hidden="true" />
              </Button>
            </li>
          ))}
          {selected.length >= 2 ? (
            <li className="flex">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClear}
                className="h-11 sm:h-7"
              >
                {t('filter.clear')}
              </Button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}
