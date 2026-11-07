import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { profileKeys, type Viewer } from '@/entities/profile'
import { taskKeys, type TaskStatus } from '@/entities/task'
import { SessionContext } from '@/shared/auth'

import { expectNoAxeViolations } from '../../../../tests/setup/axe'
import { MyTasksPage } from './my-tasks-page'

vi.mock('@/shared/api', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/shared/api')),
  getSupabaseClient: () => {
    throw new Error('unexpected request: data is seeded in the cache')
  },
}))

const LIST_PARAMS = {
  pageIndex: 0,
  pageSize: 10,
  search: '',
  sort: { id: 'status', desc: false },
  statuses: [],
} as const

function row(id: string, title: string, status: TaskStatus, objectName: string) {
  return {
    id,
    title,
    status,
    created_at: '2026-11-02T10:00:00Z',
    object: { id: `o-${id}`, name: objectName },
  }
}

function Location() {
  return <span data-testid="location">{useLocation().search}</span>
}

function renderPage(tasks: ReturnType<typeof row>[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  const viewer: Viewer = { id: 'e1', role: 'executor', fullName: 'Тест', mustChangePassword: false }
  queryClient.setQueryData(profileKeys.byId('e1'), viewer)
  queryClient.setQueryData(taskKeys.mine('e1', LIST_PARAMS), { rows: tasks, total: tasks.length })
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionContext value={{ status: 'signed-in', userId: 'e1' }}>
        <MemoryRouter>
          <MyTasksPage />
          <Location />
        </MemoryRouter>
      </SessionContext>
    </QueryClientProvider>,
  )
}

describe('MyTasksPage', () => {
  it('lists the rows of the page in the server order with the object link and status', async () => {
    const { container } = renderPage([
      row('3', 'Вернули', 'rework', 'Склад В'),
      row('2', 'Новая задача', 'new', 'Склад Б'),
      row('1', 'Принятая', 'accepted', 'Склад А'),
    ])
    const table = screen.getByRole('table', { name: 'Мои задачи' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((r) => within(r).getAllByRole('link')[0]?.textContent)).toEqual([
      'Вернули',
      'Новая задача',
      'Принятая',
    ])
    const row2 = rows[1]
    if (!row2) throw new Error('row is missing')
    expect(within(row2).getByRole('link', { name: 'Новая задача' })).toHaveAttribute(
      'href',
      '/tasks/2',
    )
    expect(within(row2).getByRole('link', { name: 'Склад Б' })).toHaveAttribute(
      'href',
      '/objects/o-2',
    )
    expect(within(row2).getByText('Новая')).toBeInTheDocument()
    await expectNoAxeViolations(container)
  })

  it('writes the status facet to the URL (the server filters)', async () => {
    renderPage([row('1', 'Новая задача', 'new', 'Склад Б')])
    await userEvent.click(screen.getByRole('button', { name: 'Статус' }))
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: /Принята/ }))
    expect(screen.getByTestId('location')).toHaveTextContent('?status=accepted')
  })

  it('hides a column from its header, keeps focus, and brings it back via «Столбцы»', async () => {
    renderPage([row('1', 'Задача', 'new', 'Склад А')])
    expect(screen.getByRole('link', { name: 'Склад А' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Сортировка: Объект' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Скрыть столбец' }))
    expect(screen.queryByRole('link', { name: 'Склад А' })).not.toBeInTheDocument()
    const columns = screen.getByRole('button', { name: 'Столбцы' })
    await vi.waitFor(() => {
      expect(columns).toHaveFocus()
    })

    await userEvent.click(columns)
    const item = await screen.findByRole('menuitemcheckbox', { name: 'Объект' })
    expect(item).not.toBeChecked()
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Название' })).not.toBeInTheDocument()
    await userEvent.click(item)
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('link', { name: 'Склад А' })).toBeInTheDocument()
  })

  it('shows an empty state', () => {
    renderPage([])
    expect(screen.getByText('Вам пока не назначено задач')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
