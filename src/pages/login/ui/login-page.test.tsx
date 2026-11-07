import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as SharedApi from '@/shared/api'
import { SessionContext, type SessionState } from '@/shared/auth'

import { expectNoAxeViolations } from '../../../../tests/setup/axe'
import { LoginPage } from './login-page'

const api = vi.hoisted(() => ({ signInWithPassword: vi.fn() }))

vi.mock('@/shared/api', async (importActual) => ({
  ...(await importActual<typeof SharedApi>()),
  signInWithPassword: api.signInWithPassword,
}))

function renderLogin(session: SessionState = { status: 'signed-out', userId: null }) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: 0 } } })}>
      <SessionContext value={session}>
        <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: '/objects' } }]}>
          <LoginPage />
        </MemoryRouter>
      </SessionContext>
    </QueryClientProvider>,
  )
}

describe('LoginPage', () => {
  beforeEach(() => {
    api.signInWithPassword.mockReset()
  })

  it('has no sign-up link and no accessibility violations', async () => {
    const { container } = renderLogin()
    expect(screen.getByRole('heading', { level: 1, name: 'Вход в Mini-CRM' })).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    await expectNoAxeViolations(container)
  })

  it('validates empty and malformed input without calling the API', async () => {
    renderLogin()
    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email')
    await userEvent.click(screen.getByRole('button', { name: 'Войти' }))
    expect(await screen.findByText('Введите корректный email')).toBeInTheDocument()
    expect(screen.getByText('Введите пароль')).toBeInTheDocument()
    expect(api.signInWithPassword).not.toHaveBeenCalled()
  })

  it('submits credentials', async () => {
    api.signInWithPassword.mockResolvedValue(undefined)
    renderLogin()
    await userEvent.type(screen.getByLabelText('Email'), 'a@example.com')
    await userEvent.type(screen.getByLabelText('Пароль'), 'Secret123')
    await userEvent.click(screen.getByRole('button', { name: 'Войти' }))
    await vi.waitFor(() => {
      expect(api.signInWithPassword).toHaveBeenCalledWith('a@example.com', 'Secret123')
    })
  })

  it('shows «Неверный email или пароль» for invalid credentials and keeps the input', async () => {
    api.signInWithPassword.mockRejectedValue(
      Object.assign(new Error('Invalid login credentials'), { code: 'invalid_credentials' }),
    )
    renderLogin()
    await userEvent.type(screen.getByLabelText('Email'), 'a@example.com')
    await userEvent.type(screen.getByLabelText('Пароль'), 'Wrong1234')
    await userEvent.click(screen.getByRole('button', { name: 'Войти' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Неверный email или пароль')
    expect(screen.getByLabelText('Email')).toHaveValue('a@example.com')
  })

  it('redirects an already signed-in user away from the form', () => {
    renderLogin({ status: 'signed-in', userId: 'u1' })
    expect(screen.queryByRole('button', { name: 'Войти' })).not.toBeInTheDocument()
  })
})
