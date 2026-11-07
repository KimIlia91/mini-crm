import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DeleteTaskButton } from './delete-task-button'

interface Result {
  data: null
  error: { code?: string; message: string } | null
}

const db = vi.hoisted(() => ({ result: null as unknown as Result, deletes: 0 }))

vi.mock('@/shared/api', () => ({
  getSupabaseClient: () => ({
    rpc: () => {
      db.deletes += 1
      return Promise.resolve(db.result)
    },
  }),
}))

function renderButton() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/tasks/t1']}>
        <Routes>
          <Route path="/tasks/t1" element={<DeleteTaskButton taskId="t1" objectId="o1" />} />
          <Route path="/objects/:objectId" element={<p>Страница объекта</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function openDialog() {
  await userEvent.click(screen.getByRole('button', { name: 'Удалить' }))
  return screen.findByRole('alertdialog')
}

describe('DeleteTaskButton', () => {
  beforeEach(() => {
    db.deletes = 0
    db.result = { data: null, error: null }
  })

  it('asks for confirmation, deletes and returns to the object', async () => {
    renderButton()
    const dialog = await openDialog()
    expect(dialog).toHaveTextContent('Удалить задачу?')
    expect(dialog).toHaveTextContent('Задача исчезнет из списков. История изменений сохранится.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }))
    expect(await screen.findByText('Страница объекта')).toBeInTheDocument()
    expect(db.deletes).toBe(1)
  })

  it('cancel closes the dialog without deleting', async () => {
    renderButton()
    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(db.deletes).toBe(0)
  })

  it('shows an error and stays when the task is not found', async () => {
    db.result = { data: null, error: { code: 'P0001', message: 'task_not_found' } }
    renderButton()
    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Задача не найдена или недоступна',
    )
    expect(screen.queryByText('Страница объекта')).not.toBeInTheDocument()
  })
})
