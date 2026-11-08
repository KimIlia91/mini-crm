import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as NotificationEntity from '@/entities/notification'
import type { AppNotification } from '@/entities/notification'
import { taskKeys } from '@/entities/task'

import { useOpenNotification } from './open-notification'

const markRead = vi.fn()
vi.mock('@/entities/notification', async (importOriginal) => ({
  ...(await importOriginal<typeof NotificationEntity>()),
  useMarkNotificationsRead: () => ({ mutate: markRead }),
}))

function note(patch: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'n1',
    kind: 'task_assigned',
    taskId: 't1',
    title: 'Задача',
    comment: null,
    actorName: null,
    createdAt: '2026-11-08T10:00:00Z',
    read: false,
    resolution: null,
    resolvedByName: null,
    ...patch,
  }
}

function setup(notification: AppNotification) {
  const queryClient = new QueryClient()
  // A «not found» left in the cache from before the task was assigned to the viewer.
  queryClient.setQueryData(taskKeys.detail('t1'), null)
  function Harness() {
    const open = useOpenNotification()
    return (
      <button
        type="button"
        onClick={() => {
          open(notification)
        }}
      >
        open
      </button>
    )
  }
  const router = createMemoryRouter([{ path: '*', element: <Harness /> }], {
    initialEntries: ['/start'],
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, queryClient }
}

describe('useOpenNotification', () => {
  beforeEach(() => {
    markRead.mockReset()
  })

  it('marks read, makes the cached task stale and navigates to the task', async () => {
    const { router, queryClient } = setup(note())
    await userEvent.click(screen.getByRole('button', { name: 'open' }))
    expect(markRead).toHaveBeenCalledWith(['n1'], expect.anything())
    expect(queryClient.getQueryState(taskKeys.detail('t1'))?.isInvalidated).toBe(true)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/tasks/t1')
    })
  })

  it('does not mark an already read notification again', async () => {
    setup(note({ read: true }))
    await userEvent.click(screen.getByRole('button', { name: 'open' }))
    expect(markRead).not.toHaveBeenCalled()
  })

  it.each([
    { kind: 'task_unassigned' },
    { kind: 'task_deleted' },
    { kind: 'task_in_review', resolution: 'deleted' },
  ] as const)('marks read but stays put when the task cannot be opened: %o', async (patch) => {
    const { router, queryClient } = setup(note(patch))
    await userEvent.click(screen.getByRole('button', { name: 'open' }))
    expect(markRead).toHaveBeenCalledTimes(1)
    expect(router.state.location.pathname).toBe('/start')
    expect(queryClient.getQueryState(taskKeys.detail('t1'))?.isInvalidated).toBe(false)
  })
})
