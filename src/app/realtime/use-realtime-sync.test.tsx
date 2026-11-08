import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as SharedApi from '@/shared/api'
import type { RealtimeHint, RealtimeStatus } from '@/shared/api'

import { HINT_COALESCE_MS, SAFETY_RESYNC_MS, useRealtimeSync } from './use-realtime-sync'

interface Subscription {
  topics: readonly string[]
  onHint: (hint: RealtimeHint) => void
  onStatus: (status: RealtimeStatus) => void
  cleanup: ReturnType<typeof vi.fn>
}
const subscriptions: Subscription[] = []

vi.mock('@/shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof SharedApi>()),
  subscribeToHints: (
    topics: readonly string[],
    onHint: Subscription['onHint'],
    onStatus: Subscription['onStatus'],
  ) => {
    const cleanup = vi.fn()
    subscriptions.push({ topics, onHint, onStatus, cleanup })
    return cleanup
  },
}))

const UID = 'u1'

function setup(viewer: { id: string; role: 'manager' | 'executor' }) {
  const queryClient = new QueryClient()
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
  const handlers = { onSubscribed: vi.fn(), onNotificationsCreated: vi.fn() }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const view = renderHook(
    ({ v }) => {
      useRealtimeSync(v, handlers)
    },
    { wrapper, initialProps: { v: viewer } },
  )
  return { ...view, invalidate, ...handlers }
}

function current(): Subscription {
  const last = subscriptions.at(-1)
  if (!last) throw new Error('no subscription')
  return last
}

describe('useRealtimeSync', () => {
  beforeEach(() => {
    subscriptions.length = 0
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('subscribes a manager to the personal and manager topics', () => {
    setup({ id: UID, role: 'manager' })
    expect(current().topics).toEqual(['user:u1', 'role:manager'])
  })

  it('subscribes an executor to the personal topic only', () => {
    setup({ id: UID, role: 'executor' })
    expect(current().topics).toEqual(['user:u1'])
  })

  it('invalidates the keys of a hint once the burst window has passed', () => {
    const { invalidate } = setup({ id: UID, role: 'manager' })
    current().onHint({ kind: 'object', id: 'o1' })
    expect(invalidate).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(HINT_COALESCE_MS)
    })
    expect(invalidate).toHaveBeenCalledTimes(3)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['objects', 'detail', 'o1'] })
  })

  it('merges a burst of hints into one invalidation per key', () => {
    const { invalidate } = setup({ id: UID, role: 'manager' })
    for (let i = 0; i < 5; i += 1) current().onHint({ kind: 'task', id: 't1', objectId: 'o1' })
    current().onHint({ kind: 'object', id: 'o1' })
    act(() => {
      vi.advanceTimersByTime(HINT_COALESCE_MS)
    })
    // task: detail, history, task lists, object detail, object lists; object adds nothing new but the
    // object lists and task lists, which are already pending.
    expect(invalidate).toHaveBeenCalledTimes(5)
  })

  it('drops pending invalidations on unmount', () => {
    const { invalidate, unmount } = setup({ id: UID, role: 'manager' })
    current().onHint({ kind: 'object', id: 'o1' })
    unmount()
    act(() => {
      vi.advanceTimersByTime(HINT_COALESCE_MS * 2)
    })
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('reports created notifications from any topic, but not updated ones', () => {
    const { onNotificationsCreated } = setup({ id: UID, role: 'manager' })
    current().onHint({ kind: 'notification', op: 'updated', ids: ['n0'] })
    expect(onNotificationsCreated).not.toHaveBeenCalled()
    current().onHint({ kind: 'notification', op: 'created', ids: ['n1'] })
    current().onHint({ kind: 'notification', op: 'created' })
    expect(onNotificationsCreated).toHaveBeenCalledTimes(2)
  })

  it('tells when a subscription is established', () => {
    const { onSubscribed } = setup({ id: UID, role: 'executor' })
    expect(onSubscribed).not.toHaveBeenCalled()
    current().onStatus('subscribed')
    expect(onSubscribed).toHaveBeenCalledTimes(1)
  })

  it('resyncs everything when subscribed again after an error or close, not on the first subscribe', () => {
    const { invalidate } = setup({ id: UID, role: 'executor' })
    current().onStatus('subscribed')
    expect(invalidate).not.toHaveBeenCalled()
    current().onStatus('error')
    expect(invalidate).not.toHaveBeenCalled()
    current().onStatus('subscribed')
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith()
    current().onStatus('subscribed')
    expect(invalidate).toHaveBeenCalledTimes(1)
    current().onStatus('closed')
    current().onStatus('subscribed')
    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  it('resyncs when the tab becomes visible and when the browser is back online', () => {
    const { invalidate } = setup({ id: UID, role: 'executor' })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(invalidate).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('online'))
    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  describe('safety resync', () => {
    const setVisibility = (state: DocumentVisibilityState) => {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state)
    }
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('re-reads everything every minute while the tab is visible', () => {
      setVisibility('visible')
      const { invalidate } = setup({ id: UID, role: 'executor' })
      act(() => {
        vi.advanceTimersByTime(SAFETY_RESYNC_MS - 1)
      })
      expect(invalidate).not.toHaveBeenCalled()
      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(invalidate).toHaveBeenCalledTimes(1)
      expect(invalidate).toHaveBeenCalledWith()
      act(() => {
        vi.advanceTimersByTime(SAFETY_RESYNC_MS)
      })
      expect(invalidate).toHaveBeenCalledTimes(2)
    })

    it('does nothing while the tab is hidden', () => {
      setVisibility('hidden')
      const { invalidate } = setup({ id: UID, role: 'executor' })
      act(() => {
        vi.advanceTimersByTime(SAFETY_RESYNC_MS * 3)
      })
      expect(invalidate).not.toHaveBeenCalled()
    })

    it('stops on unmount', () => {
      setVisibility('visible')
      const { invalidate, unmount } = setup({ id: UID, role: 'executor' })
      unmount()
      act(() => {
        vi.advanceTimersByTime(SAFETY_RESYNC_MS * 3)
      })
      expect(invalidate).not.toHaveBeenCalled()
    })
  })

  it('re-subscribes when the viewer changes and cleans up on unmount', () => {
    const { rerender, unmount, invalidate } = setup({ id: UID, role: 'executor' })
    const first = current()
    rerender({ v: { id: 'u2', role: 'manager' } })
    expect(first.cleanup).toHaveBeenCalledTimes(1)
    expect(current().topics).toEqual(['user:u2', 'role:manager'])

    const second = current()
    unmount()
    expect(second.cleanup).toHaveBeenCalledTimes(1)
    invalidate.mockClear()
    window.dispatchEvent(new Event('online'))
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('does not re-subscribe when only the callback identity changes', () => {
    const { rerender } = setup({ id: UID, role: 'executor' })
    rerender({ v: { id: UID, role: 'executor' } })
    expect(subscriptions).toHaveLength(1)
  })
})
