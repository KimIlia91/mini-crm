import { QueryClient, QueryClientProvider, queryOptions } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as NotificationEntity from '@/entities/notification'
import type { AppNotification } from '@/entities/notification'

import { useNotificationToasts } from './notification-toasts'

interface ToastCall {
  id?: string
  description?: string
  duration?: number
  action?: { label: ReactNode; onClick: () => void }
}
const toast = vi.fn<(title: string, options?: ToastCall) => void>()
const markRead = vi.fn()
let rows: AppNotification[] = []
const requestedCursors: string[] = []
let viewerId = 'u1'
/** When set, unread reads wait for it (a slow request). */
let gate: Promise<void> | null = null

vi.mock('@/shared/ui', () => ({
  toast: (...args: [string, ToastCall?]) => {
    toast(...args)
  },
}))
// The mocked queries behave like the database: the newest row, and unread rows after a time.
vi.mock('@/entities/notification', async (importOriginal) => ({
  ...(await importOriginal<typeof NotificationEntity>()),
  notificationQueries: {
    latestCreatedAt: () =>
      queryOptions({
        queryKey: ['t-latest'],
        queryFn: () =>
          Promise.resolve(
            rows
              .map((r) => r.createdAt)
              .sort()
              .at(-1) ?? null,
          ),
      }),
    unreadSince: (since: string) =>
      queryOptions({
        queryKey: ['t-since', since],
        queryFn: async () => {
          requestedCursors.push(since)
          await gate
          return rows
            .filter((r) => !r.read && new Date(r.createdAt) > new Date(since))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        },
      }),
  },
  useMarkNotificationsRead: () => ({ mutate: markRead }),
}))

function note(id: string, minute: number, patch: Partial<AppNotification> = {}): AppNotification {
  return {
    id,
    kind: 'task_assigned',
    taskId: `task-${id}`,
    title: `Задача ${id}`,
    comment: null,
    actorName: 'Анна',
    createdAt: `2026-11-08T10:${String(minute).padStart(2, '0')}:00Z`,
    read: false,
    resolution: null,
    resolvedByName: null,
    ...patch,
  }
}

function Harness() {
  useLocation() // re-render on navigation, so a changed viewer id is picked up
  const toasts = useNotificationToasts(viewerId)
  return (
    <>
      <button type="button" onClick={toasts.onSubscribed}>
        subscribed
      </button>
      <button type="button" onClick={toasts.onNotificationsCreated}>
        created
      </button>
    </>
  )
}

function setup(path = '/start') {
  const router = createMemoryRouter([{ path: '*', element: <Harness /> }], {
    initialEntries: [path],
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return {
    router,
    switchViewer: async (id: string) => {
      viewerId = id
      await act(async () => {
        await router.navigate('/start?viewer=' + id)
      })
    },
    subscribed: () => userEvent.click(screen.getByRole('button', { name: 'subscribed' })),
    created: () => userEvent.click(screen.getByRole('button', { name: 'created' })),
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

describe('useNotificationToasts', () => {
  beforeEach(() => {
    toast.mockReset()
    markRead.mockReset()
    requestedCursors.length = 0
    viewerId = 'u1'
    gate = null
    rows = [note('old1', 1), note('old2', 2)]
  })

  it('announces nothing that existed before the subscription was established', async () => {
    const { subscribed, created } = setup()
    await subscribed()
    await created()
    await settle()
    expect(toast).not.toHaveBeenCalled()
    // the start reads the overlap window once to remember what is already unread
    expect(new Set(requestedCursors)).toEqual(new Set(['2026-11-08T10:01:30.000Z']))
  })

  it('shows a toast for a notification created after the subscription, with the task title', async () => {
    const { subscribed, created } = setup()
    await subscribed()
    await settle()
    rows.push(note('a', 5), note('b', 6, { kind: 'task_rework', comment: 'Исправьте' }))
    await created()
    await waitFor(() => {
      expect(toast).toHaveBeenCalledTimes(2)
    })
    expect(toast).toHaveBeenCalledWith(
      'Назначена вам',
      expect.objectContaining({ id: 'a', description: 'Задача a · Анна' }),
    )
    expect(toast).toHaveBeenCalledWith(
      'Возвращена на доработку',
      expect.objectContaining({ id: 'b', description: 'Задача b · Анна' }),
    )
  })

  it('does not repeat a toast when the hint repeats', async () => {
    const { subscribed, created } = setup()
    await subscribed()
    await settle()
    rows.push(note('a', 5))
    await created()
    await waitFor(() => {
      expect(toast).toHaveBeenCalledTimes(1)
    })
    await created()
    await created()
    await settle()
    expect(toast).toHaveBeenCalledTimes(1)
    // the cursor moved to the shown notification
    expect(requestedCursors.at(-1)).toBe('2026-11-08T10:04:30.000Z')
  })

  it('announces only what is new on the next hint', async () => {
    const { subscribed, created } = setup()
    await subscribed()
    await settle()
    rows.push(note('a', 5))
    await created()
    await waitFor(() => {
      expect(toast).toHaveBeenCalledTimes(1)
    })
    rows.push(note('b', 7))
    await created()
    await waitFor(() => {
      expect(toast).toHaveBeenCalledTimes(2)
    })
    expect(toast).toHaveBeenLastCalledWith('Назначена вам', expect.objectContaining({ id: 'b' }))
  })

  it('does not announce notifications that are already read', async () => {
    const { subscribed, created } = setup()
    await subscribed()
    await settle()
    rows.push(note('a', 5, { read: true }))
    await created()
    await settle()
    expect(toast).not.toHaveBeenCalled()
  })

  it('shows one summary toast above three notifications', async () => {
    const { subscribed, created } = setup()
    await subscribed()
    await settle()
    rows.push(note('a', 5), note('b', 6), note('c', 7), note('d', 8))
    await created()
    await waitFor(() => {
      expect(toast).toHaveBeenCalledTimes(1)
    })
    expect(toast).toHaveBeenCalledWith(
      'Новых уведомлений: 4 — откройте список под значком колокольчика',
      expect.objectContaining({ id: 'notifications-summary', duration: 10_000 }),
    )
  })

  it('offers «Открыть» only when the task can be opened; it marks read and navigates', async () => {
    const { subscribed, created, router } = setup()
    await subscribed()
    await settle()
    rows.push(note('a', 5), note('b', 6, { kind: 'task_deleted' }))
    await created()
    await waitFor(() => {
      expect(toast).toHaveBeenCalledTimes(2)
    })
    const withLink = toast.mock.calls.find(([, options]) => options?.id === 'a')?.[1]
    const withoutLink = toast.mock.calls.find(([, options]) => options?.id === 'b')?.[1]
    expect(withoutLink?.action).toBeUndefined()
    expect(withLink?.duration).toBe(10_000)
    // visible «Открыть», announced as «Открыть задачу: <название>»
    render(<button type="button">{withLink?.action?.label}</button>)
    expect(screen.getByRole('button', { name: 'Открыть задачу: Задача a' })).toBeVisible()
    expect(screen.getByText('Открыть')).toBeVisible()

    withLink?.action?.onClick()
    expect(markRead).toHaveBeenCalledWith(['a'], expect.anything())
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/tasks/task-a')
    })
  })

  it('starts from the beginning when the viewer has no notifications yet', async () => {
    rows = []
    const { subscribed, created } = setup()
    await subscribed()
    await settle()
    rows.push(note('a', 5))
    await created()
    await waitFor(() => {
      expect(toast).toHaveBeenCalledTimes(1)
    })
  })

  it('works when the hint arrives before the subscription status', async () => {
    const { created } = setup()
    rows.push(note('a', 5))
    await created()
    await settle()
    // the cursor is taken at the first check, so the row that already exists is not announced
    expect(toast).not.toHaveBeenCalled()
  })

  it('announces a row that commits late with an older creation time, exactly once', async () => {
    const { subscribed, created } = setup()
    await subscribed()
    await settle()
    rows.push(note('b', 10))
    await created()
    await waitFor(() => {
      expect(toast).toHaveBeenCalledTimes(1)
    })
    // started before 'b' but committed after it: older created_at, within the overlap window
    rows.push(note('late', 9, { createdAt: '2026-11-08T10:09:50Z' }))
    await created()
    await waitFor(() => {
      expect(toast).toHaveBeenCalledTimes(2)
    })
    expect(toast).toHaveBeenLastCalledWith('Назначена вам', expect.objectContaining({ id: 'late' }))
    await created()
    await created()
    await settle()
    expect(toast).toHaveBeenCalledTimes(2)
  })

  it('forgets everything when the viewer changes', async () => {
    const { subscribed, created, switchViewer } = setup()
    await subscribed()
    await settle()
    rows.push(note('a', 5))
    await created()
    await waitFor(() => {
      expect(toast).toHaveBeenCalledTimes(1)
    })
    await switchViewer('u2')
    toast.mockClear()
    // the new viewer's start: rows that already exist are not announced, the cursor is read anew
    rows = [note('x', 20)]
    await subscribed()
    await created()
    await settle()
    expect(toast).not.toHaveBeenCalled()
    rows.push(note('y', 21))
    await created()
    await waitFor(() => {
      expect(toast).toHaveBeenCalledTimes(1)
    })
    expect(toast).toHaveBeenCalledWith('Назначена вам', expect.objectContaining({ id: 'y' }))
  })

  it('drops the result of a read that returns after the viewer changed', async () => {
    const { subscribed, created, switchViewer } = setup()
    await subscribed()
    await settle()
    let release: () => void = () => undefined
    gate = new Promise<void>((resolve) => {
      release = resolve
    })
    rows.push(note('a', 5))
    await created()
    await switchViewer('u2')
    gate = null
    release()
    await settle()
    expect(toast).not.toHaveBeenCalled()
  })

  it('never puts the manager’s comment in a toast', async () => {
    const { subscribed, created } = setup()
    await subscribed()
    await settle()
    rows.push(note('b', 6, { kind: 'task_rework', comment: 'Секретный комментарий' }))
    await created()
    await waitFor(() => {
      expect(toast).toHaveBeenCalledTimes(1)
    })
    expect(JSON.stringify(toast.mock.calls)).not.toContain('Секретный комментарий')
  })

  it('offers no «Открыть» when the task is already the current page', async () => {
    const { subscribed, created } = setup('/tasks/task-a')
    await subscribed()
    await settle()
    rows.push(note('a', 5))
    await created()
    await waitFor(() => {
      expect(toast).toHaveBeenCalledTimes(1)
    })
    expect(toast.mock.calls[0]?.[1]?.action).toBeUndefined()
  })
})
