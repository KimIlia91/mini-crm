import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
  queryOptions,
} from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as NotificationEntity from '@/entities/notification'
import type { AppNotification } from '@/entities/notification'
import type * as SharedApi from '@/shared/api'

import { NotificationsMenu } from './notifications-menu'

const rpc = vi.fn<(name: string) => Promise<{ error: Error | null }>>()
let total = 45
let unread = 3

vi.mock('@/shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof SharedApi>()),
  getSupabaseClient: () => ({ rpc: (name: string) => rpc(name) }),
}))
// The list behaves like the database: `limit` newest rows out of `total`.
vi.mock('@/entities/notification', async (importOriginal) => ({
  ...(await importOriginal<typeof NotificationEntity>()),
  notificationQueries: {
    unreadCount: () =>
      queryOptions({
        queryKey: ['notifications', 's-unread'],
        queryFn: () => Promise.resolve(unread),
      }),
    list: (limit: number) =>
      queryOptions({
        queryKey: ['notifications', 's-list', limit],
        queryFn: () =>
          Promise.resolve({
            total,
            items: Array.from({ length: Math.min(limit, total) }, (_, i) => item(i)),
          }),
      }),
  },
}))

function item(i: number): AppNotification {
  return {
    id: `n${String(i)}`,
    kind: 'task_assigned',
    taskId: `task-${String(i)}`,
    title: `Задача ${String(i)}`,
    comment: null,
    actorName: null,
    createdAt: '2026-11-08T10:00:00Z',
    read: true,
    resolution: null,
    resolvedByName: null,
  }
}

function setup() {
  const router = createMemoryRouter([{ path: '*', element: <NotificationsMenu /> }], {
    initialEntries: ['/objects'],
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('NotificationsMenu states', () => {
  beforeEach(() => {
    rpc.mockReset()
    total = 45
    unread = 3
  })
  afterEach(() => {
    onlineManager.setOnline(true)
  })

  it('«Показать ещё» keeps the focus: it moves to the first newly loaded item', async () => {
    setup()
    await userEvent.click(await screen.findByRole('button', { name: /непрочитанных: 3/ }))
    const more = await screen.findByRole('button', { name: 'Показать ещё' })
    more.focus()
    await userEvent.click(more)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Задача 20/ })).toHaveFocus()
    })
  })

  it('moves the focus to the first new item even when «Показать ещё» disappears', async () => {
    total = 30
    setup()
    await userEvent.click(await screen.findByRole('button', { name: /непрочитанных: 3/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Показать ещё' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Задача 20/ })).toHaveFocus()
    })
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument()
  })

  it('«Прочитать все» success is announced; the popover stays open and the focus stays on the button', async () => {
    // the counter reaches 0 right after the call, as in the app
    rpc.mockImplementationOnce(() => {
      unread = 0
      return Promise.resolve({ error: null })
    })
    setup()
    await userEvent.click(await screen.findByRole('button', { name: /непрочитанных: 3/ }))
    const markAll = await screen.findByRole('button', { name: 'Прочитать все' })
    await userEvent.click(markAll)
    expect(await screen.findByRole('status')).toHaveTextContent('Все уведомления прочитаны')
    await waitFor(() => {
      expect(markAll).toHaveAttribute('aria-disabled', 'true')
    })
    expect(screen.getByRole('dialog', { name: 'Уведомления' })).toBeVisible()
    expect(markAll).toHaveFocus()
  })

  it('says so while «Прочитать все» waits for the network', async () => {
    setup()
    await userEvent.click(await screen.findByRole('button', { name: /непрочитанных: 3/ }))
    const markAll = await screen.findByRole('button', { name: 'Прочитать все' })
    onlineManager.setOnline(false)
    await userEvent.click(markAll)
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Нет соединения — отметим, когда сеть появится',
    )
    expect(rpc).not.toHaveBeenCalled()
  })
})
