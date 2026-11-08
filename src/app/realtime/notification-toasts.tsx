import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'

import {
  notificationLink,
  notificationQueries,
  useNotificationText,
  type AppNotification,
} from '@/entities/notification'
import { toast } from '@/shared/ui'

import { useOpenNotification } from './open-notification'

/** Above this many fresh notifications one summary toast replaces the individual ones. */
export const MAX_INDIVIDUAL_TOASTS = 3

/** Notification toasts stay long enough to read and act on; hover and focus pause the timer. */
export const TOAST_WITH_ACTION_MS = 10_000
const SUMMARY_TOAST_ID = 'notifications-summary'

const EPOCH = '1970-01-01T00:00:00+00:00'

/**
 * created_at is the start time of the writing transaction, so a row can commit after a newer one.
 * Each check therefore looks this far behind the cursor and skips ids it has already seen.
 */
export const CURSOR_OVERLAP_MS = 30_000
const MAX_SEEN_IDS = 200

/** Everything the toasts remember; replaced as a whole when the viewer changes. */
interface ToastState {
  viewerId: string
  /** Creation time of the newest notification already known; null until the first read. */
  cursor: Promise<string> | null
  /** Runs checks one at a time so repeated hints never show a notification twice. */
  queue: Promise<void>
  /** Ids already announced (or present at the start), oldest first, bounded. */
  seen: Set<string>
}

function freshState(viewerId: string): ToastState {
  return { viewerId, cursor: null, queue: Promise.resolve(), seen: new Set() }
}

function remember(seen: Set<string>, id: string) {
  seen.add(id)
  if (seen.size > MAX_SEEN_IDS) {
    const oldest = seen.values().next()
    if (!oldest.done) seen.delete(oldest.value)
  }
}

function later(a: string, b: string): string {
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b
}

function windowStart(cursor: string): string {
  return new Date(new Date(cursor).getTime() - CURSOR_OVERLAP_MS).toISOString()
}

/**
 * Toasts for the viewer's new notifications. A «created» hint says nothing about which rows are
 * new (manager-wide events carry no ids), so the unread rows created shortly before a cursor are
 * read under RLS and the ones not yet seen are announced. The cursor starts at the newest existing
 * row when the subscription is established (rows in its overlap window count as already seen) and
 * moves to the newest row read. It comes from database timestamps, not the browser clock.
 * State is dropped when the viewer changes, and results of reads started for a previous viewer
 * are ignored. «Открыть» appears only when the task can still be opened.
 */
export function useNotificationToasts(viewerId: string) {
  const queryClient = useQueryClient()
  const open = useOpenNotification()
  const { pathname } = useLocation()
  // Read when a toast is shown: a read may finish after the user moved to another page.
  const currentPath = useRef(pathname)
  useEffect(() => {
    currentPath.current = pathname
  }, [pathname])
  const { t } = useTranslation('entity-notification')
  const text = useNotificationText()
  const state = useRef<ToastState>(freshState(viewerId))

  useEffect(() => {
    if (state.current.viewerId !== viewerId) state.current = freshState(viewerId)
  }, [viewerId])

  const readSince = (since: string) =>
    queryClient.query({ ...notificationQueries.unreadSince(since), staleTime: 0 })

  const ensureCursor = (current: ToastState): Promise<string> => {
    current.cursor ??= (async () => {
      try {
        const latest =
          (await queryClient.query({
            ...notificationQueries.latestCreatedAt(),
            staleTime: 0,
          })) ?? EPOCH
        // Rows already unread at the start must not be announced later through the overlap.
        for (const n of await readSince(windowStart(latest))) remember(current.seen, n.id)
        return latest
      } catch {
        // Without the cursor, fall back to «from now» rather than replaying history.
        return new Date().toISOString()
      }
    })()
    return current.cursor
  }

  const show = (items: AppNotification[]) => {
    if (items.length > MAX_INDIVIDUAL_TOASTS) {
      // One stable id: a repeat replaces the summary instead of stacking another.
      toast(t('toast.summary', { total: items.length }), {
        id: SUMMARY_TOAST_ID,
        duration: TOAST_WITH_ACTION_MS,
      })
      return
    }
    for (const n of items) {
      // Same structure as the list item: the event, the task, who did it.
      const link = notificationLink(n)
      toast(text.event(n), {
        id: n.id,
        description: n.actorName ? `${n.title} · ${n.actorName}` : n.title,
        duration: TOAST_WITH_ACTION_MS,
        action:
          link && link !== currentPath.current
            ? {
                label: (
                  <>
                    {t('toast.open')}{' '}
                    <span className="sr-only">{t('toast.openTask', { title: n.title })}</span>
                  </>
                ),
                onClick: () => {
                  open(n)
                },
              }
            : undefined,
      })
    }
  }

  const check = async (current: ToastState) => {
    const cursor = await ensureCursor(current)
    const rows = await readSince(windowStart(cursor))
    if (state.current !== current) return // the viewer changed while reading
    const fresh = rows.filter((n) => !current.seen.has(n.id)).toReversed() // oldest first
    const newest = rows.reduce<string>((acc, n) => later(acc, n.createdAt), cursor)
    current.cursor = Promise.resolve(newest)
    if (fresh.length === 0) return
    for (const n of fresh) remember(current.seen, n.id)
    show(fresh)
  }

  return {
    /** The subscription is up: fix the starting point, so nothing older is announced. */
    onSubscribed: () => {
      void ensureCursor(state.current)
    },
    /** A notification was created for the viewer. A failed read shows nothing: the bell refreshes anyway. */
    onNotificationsCreated: () => {
      const current = state.current
      current.queue = current.queue.then(() => check(current)).catch(() => undefined)
    },
  }
}
