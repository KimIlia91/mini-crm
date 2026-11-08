import { QueryClient, QueryClientProvider, queryOptions } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as NotificationEntity from '@/entities/notification'
import type * as SharedApi from '@/shared/api'
import type * as SharedUi from '@/shared/ui'

import { NotificationsMenu } from './notifications-menu'

// The real mark-read mutations run; only the transport (the RPC) is replaced and made to fail.
const rpc = vi.fn<(name: string) => Promise<{ error: Error | null }>>()
const errorToast = vi.fn<(message: string, options?: { duration?: number }) => void>()

vi.mock('@/shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof SharedApi>()),
  getSupabaseClient: () => ({ rpc: (name: string) => rpc(name) }),
}))
vi.mock('@/shared/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof SharedUi>()),
  toast: {
    error: (message: string, options?: { duration?: number }) => {
      errorToast(message, options)
    },
  },
}))
vi.mock('@/entities/notification', async (importOriginal) => ({
  ...(await importOriginal<typeof NotificationEntity>()),
  notificationQueries: {
    unreadCount: () => queryOptions({ queryKey: ['e-unread'], queryFn: () => Promise.resolve(1) }),
    list: (limit: number) =>
      queryOptions({
        queryKey: ['e-list', limit],
        queryFn: () =>
          Promise.resolve({
            total: 1,
            items: [
              {
                id: 'n1',
                kind: 'task_assigned' as const,
                taskId: 'task-1',
                title: 'Задача 1',
                comment: null,
                actorName: null,
                createdAt: '2026-11-08T10:00:00Z',
                read: false,
                resolution: null,
                resolvedByName: null,
              },
            ],
          }),
      }),
  },
}))

function setup() {
  const router = createMemoryRouter([{ path: '*', element: <NotificationsMenu /> }], {
    initialEntries: ['/objects'],
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

describe('NotificationsMenu: failed mark-read', () => {
  beforeEach(() => {
    rpc.mockReset()
    errorToast.mockReset()
  })

  it('«Прочитать все» failing shows an alert inside the popover and the button works again', async () => {
    rpc.mockRejectedValueOnce(new Error('network'))
    setup()
    await userEvent.click(await screen.findByRole('button', { name: /непрочитанных: 1/ }))
    const markAll = await screen.findByRole('button', { name: 'Прочитать все' })
    await userEvent.click(markAll)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось отметить уведомления прочитанными',
    )
    expect(screen.getByRole('dialog', { name: 'Уведомления' })).toBeVisible()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Прочитать все' })).toBeEnabled()
    })

    // a retry that succeeds clears the error
    rpc.mockResolvedValueOnce({ error: null })
    await userEvent.click(screen.getByRole('button', { name: 'Прочитать все' }))
    await waitFor(() => {
      expect(screen.queryByText(/Не удалось отметить уведомления/)).not.toBeInTheDocument()
    })
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenLastCalledWith('mark_all_notifications_read')
  })

  it('an RPC error object (not only a rejection) is reported too', async () => {
    rpc.mockResolvedValueOnce({ error: new Error('rls') })
    setup()
    await userEvent.click(await screen.findByRole('button', { name: /непрочитанных: 1/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Прочитать все' }))
    expect(await screen.findByRole('alert')).toBeVisible()
  })

  it('a failing single mark on item click reports an error toast and still navigates', async () => {
    rpc.mockRejectedValueOnce(new Error('network'))
    const router = setup()
    await userEvent.click(await screen.findByRole('button', { name: /непрочитанных: 1/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Задача 1/ }))

    await waitFor(() => {
      expect(errorToast).toHaveBeenCalledWith(
        'Не удалось отметить уведомление прочитанным',
        expect.objectContaining({ duration: 8000 }),
      )
    })
    expect(rpc).toHaveBeenCalledWith('mark_notifications_read')
    expect(router.state.location.pathname).toBe('/tasks/task-1')
  })
})
