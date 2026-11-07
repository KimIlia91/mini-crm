import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { objectKeys } from '@/entities/object'
import { profileKeys, type Viewer } from '@/entities/profile'
import { taskKeys } from '@/entities/task'
import { SessionContext } from '@/shared/auth'

import { expectNoAxeViolations } from '../../../../tests/setup/axe'
import { ObjectPage } from './object-page'

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

const OBJECT = { id: 'o1', name: 'Склад №1', address: 'ул. Ленина, 1', created_at: '2026-11-01' }
const TASKS = [
  {
    id: 't1',
    title: 'Проверить проводку',
    status: 'new' as const,
    created_at: '2026-11-02T10:00:00Z',
    assignee: { id: 'e1', full_name: 'Иван Исполнителев' },
  },
]

function renderPage(
  role: Viewer['role'],
  { object = OBJECT, tasks = TASKS }: { object?: typeof OBJECT | null; tasks?: typeof TASKS } = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  const viewer: Viewer = { id: 'u1', role, fullName: 'Тест', mustChangePassword: false }
  queryClient.setQueryData(profileKeys.byId('u1'), viewer)
  queryClient.setQueryData(objectKeys.detail('o1'), object)
  queryClient.setQueryData(taskKeys.byObject('o1', LIST_PARAMS), {
    rows: tasks,
    total: tasks.length,
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionContext value={{ status: 'signed-in', userId: 'u1' }}>
        <MemoryRouter initialEntries={['/objects/o1']}>
          <Routes>
            <Route path="/objects/:objectId" element={<ObjectPage />} />
          </Routes>
        </MemoryRouter>
      </SessionContext>
    </QueryClientProvider>,
  )
}

describe('ObjectPage', () => {
  it('gives the manager object and task controls', async () => {
    const { container } = renderPage('manager')
    expect(screen.getByRole('heading', { level: 1, name: 'Склад №1' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Проверить проводку' })).toHaveAttribute(
      'href',
      '/tasks/t1',
    )
    expect(screen.getByText('Новая')).toBeInTheDocument()
    expect(screen.getByText(/Иван Исполнителев/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Задачи' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Действия с объектом' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Добавить задачу' })).toBeInTheDocument()
    await expectNoAxeViolations(container)
  })

  it('opens edit and delete from the object actions menu', async () => {
    renderPage('manager')
    await userEvent.click(screen.getByRole('button', { name: 'Действия с объектом' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Редактировать' }))
    expect(await screen.findByRole('dialog', { name: 'Редактировать объект' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: 'Действия с объектом' })).toHaveFocus()
    })
    await userEvent.click(screen.getByRole('button', { name: 'Действия с объектом' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Удалить' }))
    expect(await screen.findByRole('alertdialog', { name: 'Удалить объект?' })).toBeInTheDocument()
  })

  it('shows the executor the object and tasks without manage controls', async () => {
    const { container } = renderPage('executor')
    expect(screen.getByRole('link', { name: 'Проверить проводку' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Действия|Добавить/ })).not.toBeInTheDocument()
    await expectNoAxeViolations(container)
  })

  it('shows an empty state when the object has no tasks', () => {
    renderPage('manager', { tasks: [] })
    expect(screen.getByText('В объекте пока нет задач')).toBeInTheDocument()
  })

  it('shows «not found» when the object is missing or hidden', async () => {
    const { container } = renderPage('executor', { object: null })
    expect(
      screen.getByRole('heading', { level: 1, name: 'Объект не найден или недоступен' }),
    ).toBeInTheDocument()
    await expectNoAxeViolations(container)
  })
})
