import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { configure, render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import type * as SharedApi from '@/shared/api'
import { SessionContext, type SessionState } from '@/shared/auth'
import { ThemeProvider } from '@/shared/theme'

import { routes } from './router'

configure({ asyncUtilTimeout: 5000 })

interface ProfileResult {
  data: unknown
  error: { message: string } | null
}

const fake = vi.hoisted((): { profile: ProfileResult; signOut: Mock } => ({
  profile: { data: null, error: null },
  signOut: vi.fn(),
}))

vi.mock('@/shared/api', async (importActual) => ({
  ...(await importActual<typeof SharedApi>()),
  signOut: fake.signOut,
  getSupabaseClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          abortSignal: () => ({ maybeSingle: () => Promise.resolve(fake.profile) }),
        }),
      }),
    }),
  }),
}))

const SIGNED_OUT: SessionState = { status: 'signed-out', userId: null }
const SIGNED_IN: SessionState = { status: 'signed-in', userId: 'u1' }

function profile(role: 'manager' | 'executor', mustChangePassword = false): ProfileResult {
  return {
    data: { id: 'u1', role, full_name: 'Иван Петров', must_change_password: mustChangePassword },
    error: null,
  }
}

function renderApp(initialEntry: string, session: SessionState) {
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui = (current: SessionState) => (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <SessionContext value={current}>
          <RouterProvider router={router} />
        </SessionContext>
      </QueryClientProvider>
    </ThemeProvider>
  )
  const view = render(ui(session))
  return {
    router,
    rerenderWith: (next: SessionState) => {
      view.rerender(ui(next))
    },
  }
}

describe('app routes', () => {
  beforeEach(() => {
    fake.profile = profile('manager')
    fake.signOut.mockReset()
  })

  describe('RequireAuth', () => {
    it('sends a signed-out user to /login and remembers path + search', async () => {
      const { router } = renderApp('/objects/42?tab=tasks', SIGNED_OUT)
      expect(await screen.findByRole('heading', { name: 'Вход в Mini-CRM' })).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/login')
      expect(router.state.location.state).toEqual({ from: '/objects/42?tab=tasks' })
    })

    it('returns to the remembered path after login', async () => {
      const { router, rerenderWith } = renderApp('/objects', SIGNED_OUT)
      expect(await screen.findByRole('heading', { name: 'Вход в Mini-CRM' })).toBeInTheDocument()
      rerenderWith(SIGNED_IN)
      expect(await screen.findByRole('heading', { name: 'Объекты' })).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/objects')
    })

    it.each(['//evil.com', 'https://evil.com', '/\\evil.com', 42])(
      'ignores the unsafe redirect target %j after login',
      async (from) => {
        const router = createMemoryRouter(routes, {
          initialEntries: [{ pathname: '/login', state: { from } }],
        })
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        render(
          <ThemeProvider>
            <QueryClientProvider client={queryClient}>
              <SessionContext value={SIGNED_IN}>
                <RouterProvider router={router} />
              </SessionContext>
            </QueryClientProvider>
          </ThemeProvider>,
        )
        expect(await screen.findByRole('heading', { name: 'Объекты' })).toBeInTheDocument()
        expect(router.state.location.pathname).toBe('/objects')
      },
    )

    it('shows «Нет доступа» with a sign-out button when the profile is missing', async () => {
      fake.profile = { data: null, error: null }
      renderApp('/objects', SIGNED_IN)
      expect(await screen.findByRole('heading', { name: 'Нет доступа' })).toBeInTheDocument()
      fake.signOut.mockResolvedValue(undefined)
      await userEvent.click(screen.getByRole('button', { name: 'Выйти' }))
      expect(fake.signOut).toHaveBeenCalledTimes(1)
    })

    it('shows a retry screen when the profile fails to load, and recovers on retry', async () => {
      fake.profile = { data: null, error: { message: 'network' } }
      renderApp('/objects', SIGNED_IN)
      expect(
        await screen.findByRole('heading', { name: 'Не удалось загрузить профиль' }),
      ).toBeInTheDocument()
      fake.profile = profile('manager')
      await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
      expect(await screen.findByRole('heading', { name: 'Объекты' })).toBeInTheDocument()
    })
  })

  describe('forced password change', () => {
    it.each(['/', '/objects', '/objects/42', '/tasks/7', '/my-tasks'])(
      'redirects %s to /change-password while a change is required',
      async (path) => {
        fake.profile = profile('executor', true)
        const { router } = renderApp(path, SIGNED_IN)
        expect(await screen.findByRole('heading', { name: 'Смена пароля' })).toBeInTheDocument()
        expect(router.state.location.pathname).toBe('/change-password')
      },
    )

    it('keeps the navigation hidden on /change-password', async () => {
      fake.profile = profile('executor', true)
      renderApp('/change-password', SIGNED_IN)
      expect(await screen.findByRole('heading', { name: 'Смена пароля' })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Объекты' })).not.toBeInTheDocument()
    })

    it('redirects /change-password to / when no change is required', async () => {
      fake.profile = profile('manager', false)
      const { router } = renderApp('/change-password', SIGNED_IN)
      expect(await screen.findByRole('heading', { name: 'Объекты' })).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/objects')
    })
  })

  describe('role routing', () => {
    it('sends an executor from / to /my-tasks and shows the executor navigation', async () => {
      fake.profile = profile('executor')
      const { router } = renderApp('/', SIGNED_IN)
      expect(await screen.findByRole('heading', { name: 'Мои задачи' })).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/my-tasks')
      const nav = within(screen.getByRole('navigation', { name: 'Основная навигация' }))
      expect(nav.getByRole('link', { name: 'Мои задачи' })).toHaveAttribute('aria-current', 'page')
      expect(screen.getByText('Иван Петров')).toBeInTheDocument()
    })

    it('sends a manager from / to /objects without «Мои задачи»', async () => {
      const { router } = renderApp('/', SIGNED_IN)
      expect(await screen.findByRole('heading', { name: 'Объекты' })).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/objects')
      const nav = within(screen.getByRole('navigation', { name: 'Основная навигация' }))
      expect(nav.getByRole('link', { name: 'Объекты' })).toBeInTheDocument()
      expect(nav.queryByRole('link', { name: 'Мои задачи' })).not.toBeInTheDocument()
    })

    it('signs out through the profile menu after a confirmation', async () => {
      fake.signOut.mockResolvedValue(undefined)
      renderApp('/objects', SIGNED_IN)
      expect(await screen.findByRole('heading', { name: 'Объекты' })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /Меню пользователя/ }))
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Выйти' }))
      const dialog = await screen.findByRole('alertdialog', { name: 'Выйти из аккаунта?' })
      expect(fake.signOut).not.toHaveBeenCalled()
      await userEvent.click(within(dialog).getByRole('button', { name: 'Выйти' }))
      expect(fake.signOut).toHaveBeenCalledTimes(1)
    })

    it('sends a manager from /my-tasks to /', async () => {
      const { router } = renderApp('/my-tasks', SIGNED_IN)
      expect(await screen.findByRole('heading', { name: 'Объекты' })).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/objects')
    })
  })

  describe('about page', () => {
    it('is public: a signed-out user stays on /about', async () => {
      const { router } = renderApp('/about', SIGNED_OUT)
      expect(
        await screen.findByRole('heading', { level: 1, name: 'О проекте' }),
      ).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/about')
    })

    it('stays visible when the profile fails to load', async () => {
      fake.profile = { data: null, error: { message: 'network' } }
      const { router } = renderApp('/about', SIGNED_IN)
      expect(
        await screen.findByRole('heading', { level: 1, name: 'О проекте' }),
      ).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/about')
    })

    it('is not redirected while a password change is required', async () => {
      fake.profile = profile('executor', true)
      const { router } = renderApp('/about', SIGNED_IN)
      expect(
        await screen.findByRole('heading', { level: 1, name: 'О проекте' }),
      ).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/about')
      expect(screen.getByRole('link', { name: 'К приложению' })).toHaveAttribute('href', '/')
    })

    it('opens from the user menu', async () => {
      const { router } = renderApp('/objects', SIGNED_IN)
      expect(await screen.findByRole('heading', { name: 'Объекты' })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /Меню пользователя/ }))
      await userEvent.click(await screen.findByRole('menuitem', { name: 'О проекте' }))
      expect(
        await screen.findByRole('heading', { level: 1, name: 'О проекте' }),
      ).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/about')
    })
  })

  it('renders the not-found page for unknown paths when signed out', async () => {
    renderApp('/definitely-missing', SIGNED_OUT)
    expect(await screen.findByRole('heading', { name: 'Страница не найдена' })).toBeInTheDocument()
  })
})
