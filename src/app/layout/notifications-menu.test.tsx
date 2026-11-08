import { QueryClient, QueryClientProvider, queryOptions } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { expectNoAxeViolations } from '../../../tests/setup/axe'

import type * as NotificationEntity from '@/entities/notification'
import type { AppNotification, NotificationPage } from '@/entities/notification'

import { NotificationsMenu } from './notifications-menu'

const markRead = vi.fn()
const markAll = vi.fn()
let unread = 0
let page: NotificationPage = { items: [], total: 0 }
let listFails = false
const requestedLimits: number[] = []

vi.mock('@/entities/notification', async (importOriginal) => ({
  ...(await importOriginal<typeof NotificationEntity>()),
  notificationQueries: {
    unreadCount: () =>
      queryOptions({ queryKey: ['t-unread'], queryFn: () => Promise.resolve(unread) }),
    list: (limit: number) =>
      queryOptions({
        queryKey: ['t-list', limit],
        queryFn: () => {
          requestedLimits.push(limit)
          return listFails ? Promise.reject(new Error('boom')) : Promise.resolve(page)
        },
        retry: false,
      }),
  },
  useMarkNotificationsRead: () => ({ mutate: markRead }),
  useMarkAllNotificationsRead: () => ({
    mutate: markAll,
    isPending: false,
    isError: false,
    reset: () => undefined,
  }),
}))

function note(id: string, patch: Partial<AppNotification> = {}): AppNotification {
  return {
    id,
    kind: 'task_assigned',
    taskId: `task-${id}`,
    title: `Задача ${id}`,
    comment: null,
    actorName: 'Анна',
    createdAt: '2026-11-08T10:00:00Z',
    read: false,
    resolution: null,
    resolvedByName: null,
    ...patch,
  }
}

function setup() {
  const router = createMemoryRouter([{ path: '*', element: <NotificationsMenu /> }], {
    initialEntries: ['/objects'],
  })
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, ...view }
}

describe('NotificationsMenu', () => {
  beforeEach(() => {
    markRead.mockReset()
    markAll.mockReset()
    requestedLimits.length = 0
    unread = 0
    page = { items: [], total: 0 }
    listFails = false
  })

  it('labels the bell with the unread count, capped at 99+', async () => {
    unread = 3
    const view = setup()
    expect(
      await screen.findByRole('button', { name: 'Уведомления, непрочитанных: 3' }),
    ).toBeVisible()
    view.unmount()

    unread = 250
    setup()
    expect(
      await screen.findByRole('button', { name: 'Уведомления, непрочитанных: 99+' }),
    ).toBeVisible()
  })

  it('has a plain label and a disabled «Прочитать все» with nothing unread', async () => {
    page = { items: [note('a', { read: true })], total: 1 }
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Уведомления' }))
    expect(await screen.findByText('Задача a')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Прочитать все' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('does not load or mark anything until opened, and opening marks nothing', async () => {
    unread = 1
    page = { items: [note('a')], total: 1 }
    setup()
    expect(await screen.findByRole('button', { name: /непрочитанных: 1/ })).toBeVisible()
    expect(requestedLimits).toEqual([])
    await userEvent.click(screen.getByRole('button', { name: /Уведомления/ }))
    expect(await screen.findByText('Задача a')).toBeVisible()
    expect(markRead).not.toHaveBeenCalled()
    expect(markAll).not.toHaveBeenCalled()
  })

  it('marks one notification read and opens its task on click', async () => {
    unread = 1
    page = { items: [note('a')], total: 1 }
    const { router } = setup()
    await userEvent.click(await screen.findByRole('button', { name: /непрочитанных: 1/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Задача a/ }))
    expect(markRead).toHaveBeenCalledWith(['a'], expect.anything())
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/tasks/task-a')
    })
  })

  it('marks a notification without a link read and stays on the page', async () => {
    unread = 1
    page = { items: [note('a', { kind: 'task_deleted' })], total: 1 }
    const { router } = setup()
    await userEvent.click(await screen.findByRole('button', { name: /непрочитанных: 1/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Задача a/ }))
    expect(markRead).toHaveBeenCalledWith(['a'], expect.anything())
    expect(router.state.location.pathname).toBe('/objects')
  })

  it('does not mark an already read notification again', async () => {
    page = { items: [note('a', { read: true })], total: 1 }
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Уведомления' }))
    await userEvent.click(await screen.findByRole('button', { name: /Задача a/ }))
    expect(markRead).not.toHaveBeenCalled()
  })

  it('marks everything read', async () => {
    unread = 2
    page = { items: [note('a'), note('b')], total: 2 }
    setup()
    await userEvent.click(await screen.findByRole('button', { name: /непрочитанных: 2/ }))
    // The live region exists before the result, so its text is announced when it appears
    // (the text itself: notifications-menu.states.test.tsx).
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    await userEvent.click(await screen.findByRole('button', { name: 'Прочитать все' }))
    expect(markAll).toHaveBeenCalledTimes(1)
  })

  it('shows who handled a request', async () => {
    page = {
      items: [
        note('a', {
          kind: 'task_in_review',
          read: true,
          resolution: 'accepted',
          resolvedByName: 'Пётр',
        }),
      ],
      total: 1,
    }
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Уведомления' }))
    expect(await screen.findByText('Принята: Пётр')).toBeVisible()
  })

  it('shows the empty state', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Уведомления' }))
    expect(await screen.findByText('Уведомлений пока нет')).toBeVisible()
  })

  it('shows an error with a retry', async () => {
    listFails = true
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Уведомления' }))
    expect(await screen.findByText('Не удалось загрузить уведомления')).toBeVisible()
    listFails = false
    page = { items: [note('a')], total: 1 }
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText('Задача a')).toBeVisible()
  })

  it('loads the next 20 on «Показать ещё» and hides it when everything is loaded', async () => {
    page = { items: [note('a')], total: 30 }
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Уведомления' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Показать ещё' }))
    await waitFor(() => {
      expect(requestedLimits).toEqual([20, 40])
    })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument()
    })
  })

  it('has no axe violations when open', async () => {
    unread = 1
    page = { items: [note('a'), note('b', { read: true })], total: 2 }
    setup()
    await userEvent.click(await screen.findByRole('button', { name: /непрочитанных: 1/ }))
    expect(await screen.findByText('Задача a')).toBeVisible()
    await expectNoAxeViolations(document.body)
  })
})
