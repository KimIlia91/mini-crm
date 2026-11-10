import { cn } from 'cn'
import { XIcon } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Popover, PopoverContent, PopoverTrigger } from '@/shared/ui'

import { fitChipCount } from '../lib/fit-chips'
import { TruncatedText } from './truncated-text'

interface SelectedChip {
  id: string
  name: string
}

interface SelectedChipsProps {
  items: readonly SelectedChip[]
  onRemove: (id: string) => void
  onClear: () => void
  /** Focus target once no chip is left to take focus. */
  onFocusLost: () => void
}

const OUT_OF_FLOW = 'invisible absolute top-0 left-0'

/** Shown/hidden chips switch `visibility` at once: a transition would keep a chip unfocusable. */
const NO_VISIBILITY_TRANSITION = 'transition-[color,background-color,border-color,box-shadow]'

/** How many leading chips of `row` fit in its single line next to «+N» and «Reset». */
function measureFit(row: HTMLElement): number {
  const chips = [...row.querySelectorAll<HTMLElement>('[data-chip]')]
  const more = row.querySelector<HTMLElement>('[data-more]')
  const reset = row.querySelector<HTMLElement>('[data-reset]')
  const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0
  return fitChipCount({
    widths: chips.map((chip) => chip.offsetWidth),
    available: row.clientWidth - (reset ? reset.offsetWidth + gap : 0),
    gap,
    moreWidth: more?.offsetWidth ?? 0,
  })
}

/** Buttons of the chips still in the line. */
function shownChips(row: HTMLElement | null): HTMLElement[] {
  return [...(row?.querySelectorAll<HTMLElement>('[data-chip]:not([data-out]) button') ?? [])]
}

/** The button of the next (or previous) row of the list that holds `button`. */
function neighbourRow(button: HTMLElement): HTMLElement | null | undefined {
  const row = button.closest('li')
  return (row?.nextElementSibling ?? row?.previousElementSibling)?.querySelector('button')
}

/**
 * Selected objects in a single line: chips as wide as their name up to a limit; the ones that do
 * not fit are taken out of the line and counted in «+N», which lists just those, each removable.
 */
export function SelectedChips({ items, onRemove, onClear, onFocusLost }: SelectedChipsProps) {
  const { t } = useTranslation('board')
  const [row, setRow] = useState<HTMLDivElement | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const more = useRef<HTMLButtonElement>(null)
  const [fitting, setFitting] = useState(items.length)
  const removedAt = useRef<{ index: number; itemsKey: string } | null>(null)
  const itemsKey = items.map((item) => `${item.id}:${item.name}`).join('|')
  const shown = Math.min(fitting, items.length)
  const hidden = items.length - shown

  useLayoutEffect(() => {
    if (!row) return
    const observer = new ResizeObserver(() => {
      setFitting(measureFit(row))
    })
    observer.observe(row)
    return () => {
      observer.disconnect()
    }
  }, [row, itemsKey])

  useLayoutEffect(() => {
    const removed = removedAt.current
    if (!row || !removed || removed.itemsKey === itemsKey || measureFit(row) !== fitting) return
    removedAt.current = null
    const chips = shownChips(row)
    const target = chips[removed.index] ?? chips.at(-1) ?? (hidden > 0 ? more.current : null)
    if (target) target.focus()
    else onFocusLost()
  }, [row, itemsKey, fitting, hidden, onFocusLost])

  return (
    <div ref={setRow} className="relative flex min-w-0 flex-1 items-center gap-1.5">
      <ul
        aria-label={t('filter.selectedList')}
        aria-hidden={shown === 0 || undefined}
        className={cn('flex min-w-0 items-center gap-1.5', shown === 0 && 'absolute top-0 left-0')}
      >
        {items.map((item, index) => (
          <li
            key={item.id}
            data-chip
            data-out={index >= shown || undefined}
            className={cn('flex shrink-0', index >= shown && OUT_OF_FLOW)}
          >
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label={t('filter.remove', { name: item.name })}
              onClick={(event) => {
                if (items.length === 1) onFocusLost()
                else
                  removedAt.current = {
                    index: shownChips(row).indexOf(event.currentTarget),
                    itemsKey,
                  }
                onRemove(item.id)
              }}
              className={cn('h-11 max-w-40 gap-1 px-2 text-xs sm:h-7', NO_VISIBILITY_TRANSITION)}
            >
              <TruncatedText text={item.name} />
              <XIcon aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      <Popover open={moreOpen && hidden > 0} onOpenChange={setMoreOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            ref={more}
            data-more
            aria-label={t('filter.hiddenLabel', { count: hidden })}
            className={cn(
              'h-11 min-w-9 shrink-0 px-2 text-xs sm:h-7',
              NO_VISIBILITY_TRANSITION,
              hidden === 0 && OUT_OF_FLOW,
            )}
          >
            {t('filter.hidden', { count: hidden })}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label={t('filter.hiddenList')}
          className="w-64 gap-0 p-1"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            setMoreOpen(false)
            const target = hidden > 0 ? more.current : shownChips(row).at(-1)
            if (target?.isConnected) target.focus()
            else onFocusLost()
          }}
        >
          <ul className="flex max-h-72 flex-col overflow-y-auto">
            {items.slice(shown).map((item) => (
              <li key={item.id} className="flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('filter.remove', { name: item.name })}
                  onClick={(event) => {
                    const neighbour = neighbourRow(event.currentTarget)
                    if (neighbour) neighbour.focus()
                    else if (items.length === 1) onFocusLost()
                    onRemove(item.id)
                  }}
                  className="h-11 w-full justify-between gap-2 px-2 font-normal sm:h-8"
                >
                  <TruncatedText text={item.name} className="flex-1 text-left" />
                  <XIcon aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
      {items.length >= 2 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-reset
          onClick={() => {
            onFocusLost()
            onClear()
          }}
          className="h-11 shrink-0 px-2 text-xs sm:h-7"
        >
          {t('filter.clear')}
        </Button>
      ) : null}
    </div>
  )
}
