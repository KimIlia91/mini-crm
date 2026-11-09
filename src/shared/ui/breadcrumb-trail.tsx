import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { createContext, use, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ChevronRightIcon, ChevronsUpDownIcon, type LucideIcon } from 'lucide-react'

import { Breadcrumb, BreadcrumbList, BreadcrumbPage } from './breadcrumb'
import { Button } from './button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu'
import { LeavingGuard } from './leaving-guard'
import { Skeleton } from './skeleton'

export interface BreadcrumbTrailItem {
  id: string
  label?: string
  to?: string
  loading?: boolean
  keepPrevious?: boolean
  icon?: LucideIcon
}

const CRUMB_TEXT = 'block max-w-36 truncate md:max-w-56'

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]
const DURATION = 0.5
const SHIFT = 12
const STEP = 0.1

function sameItems(a: readonly BreadcrumbTrailItem[], b: readonly BreadcrumbTrailItem[]): boolean {
  return (
    a.length === b.length &&
    a.every((item, index) => {
      const other = b[index]
      return (
        other?.id === item.id &&
        item.label === other.label &&
        item.to === other.to &&
        item.loading === other.loading &&
        item.keepPrevious === other.keepPrevious &&
        item.icon === other.icon
      )
    })
  )
}

type ResolvedItem = BreadcrumbTrailItem & { key: string }

interface TrailState {
  items: readonly ResolvedItem[]
  entering: Readonly<Record<string, number>>
}

const PublishItems = createContext<((items: readonly BreadcrumbTrailItem[]) => void) | null>(null)

function nextState(previous: TrailState, incoming: readonly BreadcrumbTrailItem[]): TrailState {
  const items = incoming.map((item, index): ResolvedItem => {
    const before = previous.items[index]
    const sameId = previous.items.find((known) => known.id === item.id)
    if (item.loading) {
      if (item.keepPrevious && before && !before.loading) return before
      const shown = previous.items.find((known) => known.id === item.id && !known.loading)
      return shown ?? { ...item, key: sameId?.key ?? item.id }
    }
    if (sameId) return { ...item, key: sameId.key }
    if (before?.loading && before.keepPrevious) return { ...item, key: before.key }
    return { ...item, key: item.id }
  })
  if (sameItems(previous.items, items)) return previous
  const known = new Set(previous.items.map((item) => item.key))
  const entering: Record<string, number> = {}
  let order = 0
  for (const item of items) {
    if (!known.has(item.key)) entering[item.key] = order++
  }
  return { items, entering }
}

/**
 * Owns the breadcrumb display for the whole app shell and keeps it mounted while routes change, so
 * crumbs that stay do not flicker and crumbs that leave can animate out. Routes put their crumbs in
 * with `BreadcrumbTrail` (rendered as children of this host).
 */
export function BreadcrumbTrailHost({ children }: { children?: React.ReactNode }) {
  const [state, setState] = useState<TrailState>({ items: [], entering: {} })
  const [publish] = useState(() => (items: readonly BreadcrumbTrailItem[]) => {
    setState((previous) => nextState(previous, items))
  })
  return (
    <PublishItems value={publish}>
      {children}
      <TrailView state={state} />
    </PublishItems>
  )
}

/** A route's crumbs; renders nothing itself — the surrounding `BreadcrumbTrailHost` shows them. */
export function BreadcrumbTrail({ items }: { items: readonly BreadcrumbTrailItem[] }) {
  const publish = use(PublishItems)
  const [stable, setStable] = useState(items)
  if (!sameItems(stable, items)) setStable(items)
  useEffect(() => {
    publish?.(stable)
  }, [publish, stable])
  return null
}

function useMotionParams() {
  const reduce = useReducedMotion() === true
  return { shift: reduce ? 0 : SHIFT, duration: reduce ? 0 : DURATION }
}

function CrumbContent({ item, isLast }: { item: BreadcrumbTrailItem; isLast: boolean }) {
  const label = item.label ?? ''
  if (item.loading) return <Skeleton className="h-4 w-24 rounded" />
  if (isLast || item.to === undefined) {
    return (
      <BreadcrumbPage className={CRUMB_TEXT} title={label}>
        {label}
      </BreadcrumbPage>
    )
  }
  return (
    <Link
      to={item.to}
      title={label}
      className="inline-flex min-h-6 min-w-0 items-center transition-colors hover:text-foreground"
    >
      <span className={CRUMB_TEXT} title={label}>
        {label}
      </span>
    </Link>
  )
}

function TrailView({ state }: { state: TrailState }) {
  const { shift, duration } = useMotionParams()
  const { items, entering } = state
  const lastIndex = items.length - 1
  return (
    <>
      <PathMenu items={items} />
      {items.length > 0 ? (
        <Breadcrumb className="min-w-0 max-md:hidden">
          <BreadcrumbList className="relative flex-nowrap">
            <AnimatePresence initial={false} mode="popLayout">
              {items.map((item, index) => (
                <motion.li
                  key={item.key}
                  layout="position"
                  data-slot="breadcrumb-item"
                  className="inline-flex min-w-0 overflow-clip [overflow-clip-margin:4px]"
                  initial={{ opacity: 0 }}
                  animate={{
                    opacity: 1,
                    transition: {
                      duration,
                      ease: EASE,
                      delay: duration === 0 ? 0 : (entering[item.key] ?? 0) * STEP,
                    },
                  }}
                  exit={{
                    opacity: 0,
                    transition: {
                      duration,
                      ease: EASE,
                      delay: duration === 0 ? 0 : (lastIndex - index) * STEP,
                    },
                  }}
                >
                  <motion.div
                    className="inline-flex min-w-0 items-center gap-1.5 sm:gap-2.5"
                    initial={{ x: -shift }}
                    animate={{
                      x: 0,
                      transition: {
                        duration,
                        ease: EASE,
                        delay: duration === 0 ? 0 : (entering[item.key] ?? 0) * STEP,
                      },
                    }}
                    exit={{
                      x: -shift,
                      transition: {
                        duration,
                        ease: EASE,
                        delay: duration === 0 ? 0 : (lastIndex - index) * STEP,
                      },
                    }}
                  >
                    <LeavingGuard>
                      {index > 0 ? (
                        <ChevronRightIcon
                          aria-hidden="true"
                          className="size-3.5 shrink-0 text-muted-foreground"
                        />
                      ) : null}
                      <AnimatePresence initial={false} mode="popLayout">
                        <motion.span
                          key={item.loading ? 'loading' : 'ready'}
                          className="inline-flex min-w-0"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1, transition: { duration: duration / 2 } }}
                          exit={{ opacity: 0, transition: { duration: duration / 2 } }}
                        >
                          <CrumbContent item={item} isLast={index === lastIndex} />
                        </motion.span>
                      </AnimatePresence>
                    </LeavingGuard>
                  </motion.div>
                </motion.li>
              ))}
            </AnimatePresence>
          </BreadcrumbList>
        </Breadcrumb>
      ) : null}
    </>
  )
}

/** Below md: one button with the current page; it opens the whole path as a list. */
function PathMenu({ items }: { items: readonly BreadcrumbTrailItem[] }) {
  const { t } = useTranslation('common')
  const { shift, duration } = useMotionParams()
  const lastIndex = items.length - 1
  const current = items[lastIndex]
  if (!current) return null
  const currentLabel = current.label ?? ''

  const text = (
    <span className="relative block min-w-0 flex-1 text-center">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={`${current.id}:${current.loading ? 'loading' : 'ready'}`}
          className="block truncate"
          title={currentLabel}
          initial={{ opacity: 0, x: -shift }}
          animate={{ opacity: 1, x: 0, transition: { duration, ease: EASE } }}
          exit={{ opacity: 0, x: -shift, transition: { duration, ease: EASE } }}
        >
          {current.loading ? <Skeleton className="h-4 w-24 rounded" /> : currentLabel}
        </motion.span>
      </AnimatePresence>
    </span>
  )

  if (lastIndex === 0) {
    return (
      <span className="block min-w-0 flex-1 px-2 text-center text-sm font-medium md:hidden">
        {text}
      </span>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="min-h-11 min-w-0 flex-1 gap-1 px-2 md:hidden"
          aria-label={t('breadcrumb.showPath', { label: currentLabel })}
        >
          <span aria-hidden="true" className="size-4 shrink-0" />
          {text}
          <ChevronsUpDownIcon aria-hidden="true" className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[calc(100vw-2rem)] p-1.5">
        {items.map((item, index) => {
          const isCurrent = index === lastIndex
          const label = item.label ?? ''
          const Icon = item.icon
          const body = (
            <>
              {Icon ? (
                <Icon
                  aria-hidden="true"
                  className={isCurrent ? 'text-primary' : 'text-muted-foreground'}
                />
              ) : null}
              {item.loading ? (
                <Skeleton className="h-4 w-24 rounded" />
              ) : (
                <span
                  className="line-clamp-2 min-w-0 flex-1 [overflow-wrap:anywhere]"
                  title={label}
                >
                  {label}
                </span>
              )}
            </>
          )
          const rowClass = 'min-h-11 gap-3 px-3'
          if (isCurrent || item.to === undefined) {
            return (
              <DropdownMenuItem
                key={item.id}
                aria-current={isCurrent ? 'page' : undefined}
                className={`${rowClass} bg-primary/10 font-medium text-foreground ring-1 ring-primary ring-inset`}
              >
                {body}
              </DropdownMenuItem>
            )
          }
          return (
            <DropdownMenuItem key={item.id} asChild className={rowClass}>
              <Link to={item.to}>{body}</Link>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
