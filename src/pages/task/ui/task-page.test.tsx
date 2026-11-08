import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { profileKeys, type Viewer } from '@/entities/profile'
import { taskKeys, transitionKeys, type TaskStatus } from '@/entities/task'
import { SessionContext } from '@/shared/auth'
import { formatDateTime } from '@/shared/lib'

import { expectNoAxeViolations } from '../../../../tests/setup/axe'
import { TaskPage } from './task-page'

vi.mock('@/shared/api', () => ({
  getSupabaseClient: () => {
    throw new Error('unexpected request: data is seeded in the cache')
  },
}))

const CREATED_AT = '2026-11-02T10:00:00Z'
const REWORK_AT = '2026-11-03T12:30:00Z'

function taskRow(status: TaskStatus) {
  return {
    id: 't1',
    title: 'Проверить проводку',
    description: 'Подробности работ',
    status,
    created_at: CREATED_AT,
    assignee_id: 'e1',
    object_id: 'o1',
    object: { id: 'o1', name: 'Склад №1' },
    assignee: { id: 'e1', full_name: 'Иван Исполнителев', email: 'i@example.com' },
    author: { id: 'm1', full_name: 'Мария Постановщикова', email: 'm@example.com' },
  }
}

const HISTORY = [
  {
    id: 1,
    from_status: null,
    to_status: 'new',
    comment: null,
    changed_at: CREATED_AT,
    changed_by: { id: 'm1', full_name: 'Мария Постановщикова' },
  },
  {
    id: 2,
    from_status: 'in_review',
    to_status: 'rework',
    comment: 'Нет фото результата',
    changed_at: REWORK_AT,
    changed_by: { id: 'm1', full_name: 'Мария Постановщикова' },
  },
]

function renderPage(role: Viewer['role'], task: ReturnType<typeof taskRow> | null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  const viewer: Viewer = {
    id: role === 'manager' ? 'm1' : 'e1',
    role,
    fullName: 'Тест',
    mustChangePassword: false,
  }
  queryClient.setQueryData(profileKeys.byId(viewer.id), viewer)
  queryClient.setQueryData(taskKeys.detail('t1'), task)
  queryClient.setQueryData(taskKeys.history('t1'), HISTORY)
  queryClient.setQueryData(transitionKeys.all, [])
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionContext value={{ status: 'signed-in', userId: viewer.id }}>
        <MemoryRouter initialEntries={['/tasks/t1']}>
          <Routes>
            <Route path="/tasks/:taskId" element={<TaskPage />} />
          </Routes>
        </MemoryRouter>
      </SessionContext>
    </QueryClientProvider>,
  )
  return { ...view, queryClient }
}

describe('TaskPage', () => {
  it('shows the task data', async () => {
    const { container } = renderPage('manager', taskRow('in_review'))
    expect(
      screen.getByRole('heading', { level: 1, name: 'Проверить проводку' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Склад №1' })).toHaveAttribute('href', '/objects/o1')
    expect(screen.getByText('Иван Исполнителев')).toBeInTheDocument()
    expect(screen.getByText('Подробности работ')).toBeInTheDocument()
    expect(screen.getAllByText('Мария Постановщикова').length).toBeGreaterThan(0)
    await expectNoAxeViolations(container)
  })

  it('lets the manager edit and delete a task in review through the actions menu', async () => {
    renderPage('manager', taskRow('in_review'))
    await userEvent.click(screen.getByRole('button', { name: 'Действия с задачей' }))
    expect(await screen.findByRole('menuitem', { name: 'Редактировать' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Удалить' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Редактировать' }))
    expect(await screen.findByRole('dialog', { name: 'Редактирование задачи' })).toBeInTheDocument()
  })

  it('keeps the open edit form and its input when a background refetch fails', async () => {
    const { queryClient } = renderPage('manager', taskRow('in_review'))
    await userEvent.click(screen.getByRole('button', { name: 'Действия с задачей' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Редактировать' }))
    const dialog = await screen.findByRole('dialog', { name: 'Редактирование задачи' })
    const title = within(dialog).getByLabelText('Название')
    await userEvent.type(title, ' срочно')

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: taskKeys.detail('t1') })
      // TanStack Query notifies observers on the next macrotask.
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(queryClient.getQueryState(taskKeys.detail('t1'))?.status).toBe('error')

    const stillOpen = screen.getByRole('dialog', { name: 'Редактирование задачи' })
    expect(within(stillOpen).getByLabelText('Название')).toHaveValue('Проверить проводку срочно')
    expect(
      screen.getByRole('heading', { level: 1, name: 'Проверить проводку', hidden: true }),
    ).toBeInTheDocument()
  })

  it('opens the delete confirmation from the actions menu', async () => {
    renderPage('manager', taskRow('in_review'))
    await userEvent.click(screen.getByRole('button', { name: 'Действия с задачей' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Удалить' }))
    expect(await screen.findByRole('alertdialog', { name: 'Удалить задачу?' })).toBeInTheDocument()
  })

  it('hides edit but keeps delete for the manager on an accepted task', async () => {
    renderPage('manager', taskRow('accepted'))
    await userEvent.click(screen.getByRole('button', { name: 'Действия с задачей' }))
    expect(await screen.findByRole('menuitem', { name: 'Удалить' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Редактировать' })).not.toBeInTheDocument()
  })

  it('shows the executor no actions menu', () => {
    renderPage('executor', taskRow('in_progress'))
    expect(screen.queryByRole('button', { name: 'Действия с задачей' })).not.toBeInTheDocument()
  })

  it('renders the history as a timeline: creation, from → to badges, who, when, comment', () => {
    renderPage('executor', taskRow('rework'))
    const rows = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(rows).toHaveLength(2)

    expect(rows[0]).toHaveTextContent('Задача создана')
    expect(rows[0]).toHaveTextContent('Новая')
    expect(rows[0]).toHaveTextContent(`Мария Постановщикова, ${formatDateTime(CREATED_AT)}`)

    expect(rows[1]).toHaveTextContent('На проверке')
    expect(rows[1]).toHaveTextContent('На доработке')
    expect(rows[1]).toHaveTextContent(`Мария Постановщикова, ${formatDateTime(REWORK_AT)}`)
    expect(rows[1]).toHaveTextContent('Нет фото результата')
  })

  it('shows the latest rework remark to the executor of a returned task', () => {
    renderPage('executor', taskRow('rework'))
    const note = screen.getByRole('note', { name: 'Замечание постановщика' })
    expect(note).toHaveTextContent('Нет фото результата')
    expect(note).toHaveTextContent('Мария Постановщикова')
  })

  it('shows no remark for a task that is not in rework', () => {
    renderPage('executor', taskRow('in_progress'))
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('shows «not found» when the task is missing or hidden', async () => {
    const { container } = renderPage('executor', null)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Задача не найдена или недоступна' }),
    ).toBeInTheDocument()
    await expectNoAxeViolations(container)
  })
})
