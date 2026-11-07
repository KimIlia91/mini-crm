import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ObjectRow } from '@/entities/object'

import { DeleteObjectButton } from './delete-object-button'

const db = vi.hoisted(() => ({ select: vi.fn() }))

vi.mock('@/shared/api', () => ({
  getSupabaseClient: () => ({
    rpc: db.select,
  }),
}))

const object: ObjectRow = { id: 'o1', name: 'Склад', address: 'Адрес', created_at: '2026-01-01' }

async function openAndConfirm(onDeleted?: () => void) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: 0 } } })}>
      <DeleteObjectButton object={object} onDeleted={onDeleted} />
    </QueryClientProvider>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Удалить объект «Склад»' }))
  expect(await screen.findByRole('alertdialog', { name: 'Удалить объект?' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Удалить' }))
}

describe('DeleteObjectButton', () => {
  beforeEach(() => {
    db.select.mockReset()
  })

  it('keeps the dialog open and explains that the object has active tasks', async () => {
    db.select.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'object_has_tasks' },
    })
    const onDeleted = vi.fn()
    await openAndConfirm(onDeleted)
    expect(
      await screen.findByText('Нельзя удалить объект, пока в нём есть активные задачи'),
    ).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('explains that the object is not found or already deleted', async () => {
    db.select.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'object_not_found' },
    })
    const onDeleted = vi.fn()
    await openAndConfirm(onDeleted)
    expect(await screen.findByText('Объект не найден или уже удалён')).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('closes and calls onDeleted on success', async () => {
    db.select.mockResolvedValue({ data: null, error: null })
    const onDeleted = vi.fn()
    await openAndConfirm(onDeleted)
    await vi.waitFor(() => {
      expect(onDeleted).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
  })
})
