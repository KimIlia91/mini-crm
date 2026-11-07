import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { profileKeys } from '@/entities/profile'
import type * as SharedApi from '@/shared/api'

import { expectNoAxeViolations } from '../../../../tests/setup/axe'
import { ChangePasswordPage } from './change-password-page'

const api = vi.hoisted(() => ({ updatePassword: vi.fn() }))

vi.mock('@/shared/api', async (importActual) => ({
  ...(await importActual<typeof SharedApi>()),
  updatePassword: api.updatePassword,
}))

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/change-password']}>
        <Routes>
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route path="/" element={<p>Главная</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { invalidate, ...view }
}

async function fillAndSubmit(newPassword: string, confirmPassword = newPassword) {
  await userEvent.type(screen.getByLabelText('Новый пароль'), newPassword)
  await userEvent.type(screen.getByLabelText('Повторите пароль'), confirmPassword)
  await userEvent.click(screen.getByRole('button', { name: 'Сменить пароль' }))
}

describe('ChangePasswordPage', () => {
  beforeEach(() => {
    api.updatePassword.mockReset()
  })

  it('has no accessibility violations', async () => {
    const { container } = setup()
    await expectNoAxeViolations(container)
  })

  it('does not call the API for an invalid form', async () => {
    setup()
    await fillAndSubmit('short', 'other')
    expect(await screen.findByText('Минимум 8 символов')).toBeInTheDocument()
    expect(screen.getByText('Пароли не совпадают')).toBeInTheDocument()
    expect(api.updatePassword).not.toHaveBeenCalled()
  })

  it.each([
    ['same_password', 'Новый пароль должен отличаться от текущего'],
    [
      'weak_password',
      'Слишком простой пароль: минимум 8 символов, строчные и заглавные буквы и цифра',
    ],
  ])('shows the text for the server error %s and keeps the page', async (code, text) => {
    api.updatePassword.mockRejectedValue(Object.assign(new Error('x'), { code }))
    setup()
    await fillAndSubmit('Abcdef1x')
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    expect(screen.queryByText('Главная')).not.toBeInTheDocument()
  })

  it('on success invalidates the profile and navigates to /', async () => {
    api.updatePassword.mockResolvedValue(undefined)
    const { invalidate } = setup()
    await fillAndSubmit('Abcdef1x')
    expect(await screen.findByText('Главная')).toBeInTheDocument()
    expect(api.updatePassword).toHaveBeenCalledWith('Abcdef1x')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: profileKeys.all })
  })
})
