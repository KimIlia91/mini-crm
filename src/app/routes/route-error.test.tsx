import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { configure, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as AboutApi from '@/pages/about'
import type * as ObjectsApi from '@/pages/objects'
import type * as SharedApi from '@/shared/api'
import { SessionContext, type SessionState } from '@/shared/auth'
import { ThemeProvider } from '@/shared/theme'

import { routes } from './router'

configure({ asyncUtilTimeout: 5000 })

const crash = vi.hoisted(() => ({ objects: false, about: false }))

function Boom(): never {
  throw new Error('render failed')
}

vi.mock('@/pages/objects', async (importActual) => {
  const actual = await importActual<typeof ObjectsApi>()
  return {
    ...actual,
    ObjectsPage: () => (crash.objects ? <Boom /> : <actual.ObjectsPage />),
  }
})

vi.mock('@/pages/about', async (importActual) => {
  const actual = await importActual<typeof AboutApi>()
  return { ...actual, AboutPage: () => (crash.about ? <Boom /> : <actual.AboutPage />) }
})

vi.mock('@/shared/api', async (importActual) => ({
  ...(await importActual<typeof SharedApi>()),
  getSupabaseClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          abortSignal: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: {
                  id: 'u1',
                  role: 'manager',
                  full_name: 'Иван Петров',
                  must_change_password: false,
                },
                error: null,
              }),
          }),
        }),
      }),
    }),
  }),
}))

const SIGNED_IN: SessionState = { status: 'signed-in', userId: 'u1' }
const SIGNED_OUT: SessionState = { status: 'signed-out', userId: null }

function openAt(path: string, session: SessionState) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <SessionContext value={session}>
          <RouterProvider router={router} />
        </SessionContext>
      </QueryClientProvider>
    </ThemeProvider>,
  )
  return router
}

describe('route errors', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    crash.objects = false
    crash.about = false
    vi.restoreAllMocks()
  })

  it('shows the error inside the app shell when a page crashes', async () => {
    crash.objects = true
    openAt('/objects', SIGNED_IN)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Что-то пошло не так' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Основная навигация' })).toBeInTheDocument()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Обновить страницу' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'На главную' })).toHaveAttribute('href', '/')
    expect(screen.queryByText('render failed')).not.toBeInTheDocument()
    expect(document.title).toBe('Ошибка — Mini-CRM')
  })

  it('shows a full-page error when a page outside the app shell crashes', async () => {
    crash.about = true
    openAt('/about', SIGNED_OUT)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Что-то пошло не так' }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.queryByRole('navigation', { name: 'Основная навигация' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Обновить страницу' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'На главную' })).toHaveAttribute('href', '/')
  })

  it('leaves the error once the user navigates away', async () => {
    crash.objects = true
    const router = openAt('/objects', SIGNED_IN)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Что-то пошло не так' }),
    ).toBeInTheDocument()

    crash.objects = false
    await router.navigate('/objects')

    expect(await screen.findByRole('heading', { level: 1, name: 'Объекты' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Что-то пошло не так' })).not.toBeInTheDocument()
  })
})
