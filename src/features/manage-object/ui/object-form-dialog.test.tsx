import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { expectNoAxeViolations } from '../../../../tests/setup/axe'
import { ObjectFormDialog } from './object-form-dialog'

const db = vi.hoisted(() => ({ insert: vi.fn(), maybeSingle: vi.fn() }))

vi.mock('@/shared/api', () => ({
  getSupabaseClient: () => ({
    from: () => ({
      insert: db.insert,
      update: () => ({ eq: () => ({ select: () => ({ maybeSingle: db.maybeSingle }) }) }),
    }),
  }),
}))

function renderDialog() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: 0 } } })}>
      <ObjectFormDialog trigger={<button type="button">Добавить объект</button>} />
    </QueryClientProvider>,
  )
}

describe('ObjectFormDialog', () => {
  beforeEach(() => {
    db.insert.mockReset()
    db.maybeSingle.mockReset()
  })

  it('shows validation messages and does not call the API', async () => {
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Добавить объект' }))
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }))
    expect(await screen.findByText('Введите название')).toBeInTheDocument()
    expect(screen.getByText('Введите адрес')).toBeInTheDocument()
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('submits trimmed values and closes on success', async () => {
    db.insert.mockResolvedValue({ error: null })
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Добавить объект' }))
    await userEvent.type(screen.getByLabelText('Название'), '  Склад ')
    await userEvent.type(screen.getByLabelText('Адрес'), 'ул. Ленина, 1')
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }))
    expect(db.insert).toHaveBeenCalledWith({ name: 'Склад', address: 'ул. Ленина, 1' })
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('shows a mapped server error and keeps the input', async () => {
    db.insert.mockResolvedValue({ error: { code: '42501', message: 'denied' } })
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Добавить объект' }))
    await userEvent.type(screen.getByLabelText('Название'), 'Склад')
    await userEvent.type(screen.getByLabelText('Адрес'), 'Адрес')
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }))
    expect(await screen.findByText('Недостаточно прав')).toBeInTheDocument()
    expect(screen.getByLabelText('Название')).toHaveValue('Склад')
  })

  it('has no accessibility violations when open', async () => {
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Добавить объект' }))
    const dialog = await screen.findByRole('dialog', { name: 'Добавить объект' })
    await expectNoAxeViolations(dialog)
  })
})

describe('ObjectFormDialog edit', () => {
  const object = { id: 'o1', name: 'Склад', address: 'Адрес', created_at: '2026-01-01' }

  function renderEdit() {
    return render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { mutations: { retry: 0 } } })}
      >
        <ObjectFormDialog object={object} trigger={<button type="button">Править</button>} />
      </QueryClientProvider>,
    )
  }

  beforeEach(() => {
    db.maybeSingle.mockReset()
  })

  it('prefills values and shows the not-available error when no row was updated', async () => {
    db.maybeSingle.mockResolvedValue({ data: null, error: null })
    renderEdit()
    await userEvent.click(screen.getByRole('button', { name: 'Править' }))
    expect(screen.getByLabelText('Название')).toHaveValue('Склад')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('Объект не найден или уже удалён')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
