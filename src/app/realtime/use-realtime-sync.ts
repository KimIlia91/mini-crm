import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useEffect, useEffectEvent } from 'react'

import type { Viewer } from '@/entities/profile'
import { MANAGER_TOPIC, subscribeToHints, userTopic } from '@/shared/api'

import { keysForHint } from './hint-keys'

/** Hints arriving within this window are merged, so a burst causes one refetch per query. */
export const HINT_COALESCE_MS = 150

/** Period of the safety resync while the tab is visible. */
export const SAFETY_RESYNC_MS = 60_000

export interface RealtimeSyncHandlers {
  /** A subscription became (or is again) established. */
  onSubscribed: () => void
  /** A notification was created for the viewer (any topic). */
  onNotificationsCreated: () => void
}

/** Topics the viewer may read (the database authorises the same set). */
export function topicsFor(viewer: Pick<Viewer, 'id' | 'role'>): string[] {
  return viewer.role === 'manager' ? [userTopic(viewer.id), MANAGER_TOPIC] : [userTopic(viewer.id)]
}

/**
 * Keeps cached data fresh while the viewer is signed in: invalidates queries named by realtime
 * hints, and re-reads everything after a possibly missed message (reconnect, tab shown, back online).
 * Re-subscribes when the user or role changes; unsubscribes on unmount.
 */
export function useRealtimeSync(
  viewer: Pick<Viewer, 'id' | 'role'>,
  handlers: RealtimeSyncHandlers,
) {
  const queryClient = useQueryClient()
  const subscribed = useEffectEvent(handlers.onSubscribed)
  const notificationsCreated = useEffectEvent(handlers.onNotificationsCreated)
  const { id, role } = viewer

  useEffect(() => {
    const resync = () => {
      void queryClient.invalidateQueries()
    }

    const pending = new Map<string, QueryKey>()
    let timer: ReturnType<typeof setTimeout> | undefined
    const flush = () => {
      timer = undefined
      for (const queryKey of pending.values()) void queryClient.invalidateQueries({ queryKey })
      pending.clear()
    }

    let needsResync = false
    const unsubscribe = subscribeToHints(
      topicsFor({ id, role }),
      (hint) => {
        for (const queryKey of keysForHint(hint)) pending.set(JSON.stringify(queryKey), queryKey)
        timer ??= setTimeout(flush, HINT_COALESCE_MS)
        if (hint.kind === 'notification' && hint.op === 'created') notificationsCreated()
      },
      (status) => {
        if (status !== 'subscribed') {
          needsResync = true
          return
        }
        subscribed()
        if (needsResync) {
          needsResync = false
          resync()
        }
      },
    )
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') resync()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('online', resync)
    // Realtime may drop hints under rate limits: a visible tab re-reads active queries periodically.
    const safetyTimer = setInterval(() => {
      if (document.visibilityState === 'visible') resync()
    }, SAFETY_RESYNC_MS)
    return () => {
      clearInterval(safetyTimer)
      unsubscribe()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('online', resync)
    }
  }, [id, role, queryClient])
}
