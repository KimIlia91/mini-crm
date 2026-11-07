import { act, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, useLocation, useSearchParams } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { AppLayout } from './app-layout'

vi.mock('@/entities/profile', () => ({ useViewer: () => ({}) }))
vi.mock('../layout/app-header', () => ({ AppHeader: () => null }))
vi.mock('../layout/app-sidebar', () => ({ AppSidebar: () => null }))

function Page({ name }: { name: string }) {
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  return (
    <p>
      {name}: {pathname}?{params.toString()}
    </p>
  )
}

const scrollTo = vi.fn()
window.scrollTo = scrollTo

function setup() {
  scrollTo.mockClear()
  const router = createMemoryRouter(
    [
      {
        element: <AppLayout />,
        children: [
          { path: '/a', element: <Page name="A" /> },
          { path: '/b', element: <Page name="B" /> },
        ],
      },
    ],
    { initialEntries: ['/a?x=1'] },
  )
  render(<RouterProvider router={router} />)
  return router
}

describe('AppLayout page transition', () => {
  it('lets the leaving page keep reading its own location while it fades out', async () => {
    const router = setup()
    expect(screen.getByText('A: /a?x=1')).toBeInTheDocument()

    await act(async () => {
      await router.navigate('/b?y=2')
    })
    expect(screen.getByText('A: /a?x=1')).toBeInTheDocument()
    expect(screen.queryByText(/^B:/)).not.toBeInTheDocument()

    expect(scrollTo).not.toHaveBeenCalled()
    expect(await screen.findByText('B: /b?y=2')).toBeInTheDocument()
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
    await waitFor(() => {
      expect(screen.queryByText(/^A:/)).not.toBeInTheDocument()
    })
  })

  it('does not start a transition when only the search params change', async () => {
    const router = setup()
    await act(async () => {
      await router.navigate('/a?x=2')
    })
    expect(screen.getByText('A: /a?x=2')).toBeInTheDocument()
  })
})
