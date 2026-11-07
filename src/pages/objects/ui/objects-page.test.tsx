import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import type { AppRole } from '@/entities/profile'

import { expectNoAxeViolations } from '../../../../tests/setup/axe'
import { ObjectsPage } from './objects-page'

const mocks = vi.hoisted(() => {
  const state: { list: Mock<(orArg: string) => Promise<unknown>>; role: AppRole } = {
    list: vi.fn<(orArg: string) => Promise<unknown>>(),
    role: 'manager',
  }
  return state
})

const mocks_chain = vi.hoisted(() => ({ orArg: '' }))

vi.mock('@/shared/api', async () => {
  const chain = {
    select: () => {
      mocks_chain.orArg = ''
      return chain
    },
    or: (arg: string) => {
      mocks_chain.orArg = arg
      return chain
    },
    order: () => chain,
    range: () => chain,
    abortSignal: () => chain,
    overrideTypes: () => mocks.list(mocks_chain.orArg),
  }
  return {
    ...(await vi.importActual<Record<string, unknown>>('@/shared/api')),
    getSupabaseClient: () => ({ from: () => chain }),
  }
})

vi.mock('@/entities/profile', () => ({
  useViewer: () => ({ id: 'u1', role: mocks.role, fullName: 'Тест', mustChangePassword: false }),
}))

const rows = [
  { id: 'o1', name: 'Склад', address: 'ул. Ленина, 1', created_at: '2026-01-01' },
  { id: 'o2', name: 'Офис', address: 'ул. Мира, 2', created_at: '2026-01-02' },
]

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: 0 } } })}>
      <MemoryRouter>
        <ObjectsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ObjectsPage', () => {
  beforeEach(() => {
    mocks.list.mockReset()
    mocks.role = 'manager'
  })

  it('shows loading state first', () => {
    mocks.list.mockReturnValue(new Promise(() => undefined))
    renderPage()
    expect(screen.getByRole('table', { name: 'Список объектов' })).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('manager sees links and management controls', async () => {
    mocks.list.mockResolvedValue({ data: rows, error: null, count: rows.length })
    const { container } = renderPage()
    expect(await screen.findByRole('link', { name: /Склад/ })).toHaveAttribute(
      'href',
      '/objects/o1',
    )
    expect(screen.getByRole('button', { name: 'Добавить объект' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Действия с объектом «Склад»' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Действия с объектом «Офис»' })).toBeInTheDocument()
    await expectNoAxeViolations(container)
  })

  it('opens the edit dialog and the delete confirmation from the row menu', async () => {
    mocks.list.mockResolvedValue({ data: rows, error: null, count: rows.length })
    renderPage()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Действия с объектом «Склад»' }),
    )
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Редактировать' }))
    expect(await screen.findByRole('dialog', { name: 'Редактировать объект' })).toBeInTheDocument()
    expect(screen.getByLabelText('Название')).toHaveValue('Склад')
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: 'Действия с объектом «Офис»' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Удалить' }))
    expect(await screen.findByRole('alertdialog', { name: 'Удалить объект?' })).toBeInTheDocument()
  })

  it('sends the search to the server (name or address, literal) after the debounce', async () => {
    mocks.list.mockImplementation((orArg: string) =>
      Promise.resolve(
        orArg.includes('мира')
          ? { data: [rows[1]], error: null, count: 1 }
          : orArg === ''
            ? { data: rows, error: null, count: 2 }
            : { data: [], error: null, count: 0 },
      ),
    )
    renderPage()
    expect(await screen.findByRole('link', { name: 'Склад' })).toBeInTheDocument()
    const search = screen.getByRole('searchbox', { name: 'Поиск по названию и адресу' })
    await userEvent.type(search, 'мира')
    await vi.waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Склад' })).not.toBeInTheDocument()
    })
    expect(await screen.findByRole('link', { name: 'Офис' })).toBeInTheDocument()
    expect(mocks.list).toHaveBeenLastCalledWith('name.ilike."*мира*",address.ilike."*мира*"')
    await userEvent.clear(search)
    await userEvent.type(search, 'нет такого')
    expect(await screen.findByText('Ничего не найдено')).toBeInTheDocument()
    expect(
      screen.getByRole('searchbox', { name: 'Поиск по названию и адресу' }),
    ).toBeInTheDocument()
  })

  it('keeps the toolbar and focus while a cleared search is waiting for the debounce', async () => {
    mocks.list.mockImplementation((orArg: string) =>
      Promise.resolve(
        orArg === '' ? { data: rows, error: null, count: 2 } : { data: [], error: null, count: 0 },
      ),
    )
    renderPage()
    expect(await screen.findByRole('link', { name: 'Склад' })).toBeInTheDocument()
    const search = screen.getByRole('searchbox', { name: 'Поиск по названию и адресу' })
    await userEvent.type(search, 'zzz-nothing')
    expect(await screen.findByText('Ничего не найдено')).toBeInTheDocument()

    await userEvent.clear(search)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(screen.getByRole('searchbox', { name: 'Поиск по названию и адресу' })).toHaveFocus()
    expect(screen.queryByText('Объектов пока нет')).not.toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Склад' })).toBeInTheDocument()
  })

  it('executor sees only the list', async () => {
    mocks.role = 'executor'
    mocks.list.mockResolvedValue({ data: rows, error: null, count: rows.length })
    renderPage()
    expect(await screen.findByRole('link', { name: /Офис/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Добавить объект/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Действия с объектом/ })).not.toBeInTheDocument()
  })

  it('shows the manager empty state', async () => {
    mocks.list.mockResolvedValue({ data: [], error: null, count: 0 })
    renderPage()
    expect(await screen.findByText('Объектов пока нет')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Добавить объект' })).toBeInTheDocument()
  })

  it('shows the executor empty state', async () => {
    mocks.role = 'executor'
    mocks.list.mockResolvedValue({ data: [], error: null, count: 0 })
    renderPage()
    expect(await screen.findByText('У вас пока нет объектов с задачами')).toBeInTheDocument()
  })

  it('shows an error and retries', async () => {
    mocks.list.mockResolvedValueOnce({
      data: null,
      error: { code: 'x', message: 'fail' },
      count: null,
    })
    mocks.list.mockResolvedValue({ data: rows, error: null, count: rows.length })
    renderPage()
    expect(await screen.findByText(/Не удалось загрузить объекты/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByRole('link', { name: /Склад/ })).toBeInTheDocument()
  })
})
