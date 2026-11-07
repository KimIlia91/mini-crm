import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Link,
  RouterProvider,
  UNSAFE_LocationContext as LocationContext,
  createMemoryRouter,
  useLocation,
  useNavigationType,
  useOutlet,
} from 'react-router'
import { describe, expect, it } from 'vitest'

import { useDebouncedSearch, useTableUrlState } from '@/shared/lib'
import { PageTransition } from '@/shared/ui'

/** The same freezing as AppLayout: the leaving page keeps its own location while it fades out. */
function Layout() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const outlet = useOutlet()
  return (
    <PageTransition transitionKey={location.pathname}>
      <LocationContext value={{ location, navigationType }}>{outlet}</LocationContext>
    </PageTransition>
  )
}

function ListPage() {
  const urlState = useTableUrlState({ pageSizes: [10], listKey: 'test-list' })
  useDebouncedSearch(urlState, 100)
  return (
    <div>
      <input
        aria-label="search"
        value={urlState.globalFilter}
        onChange={(event) => {
          urlState.onGlobalFilterChange(event.target.value)
        }}
      />
      <Link to="/tasks/1">open</Link>
    </div>
  )
}

function SearchEcho() {
  return <p data-testid="echo">{useLocation().pathname + useLocation().search}</p>
}

describe('page that is fading out', () => {
  it('does not write its search params into the URL of the page being opened', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter(
      [
        {
          Component: Layout,
          children: [
            { path: '/list', Component: ListPage },
            { path: '/tasks/:id', Component: SearchEcho },
          ],
        },
      ],
      { initialEntries: ['/list?page=2'] },
    )
    render(<RouterProvider router={router} />)

    await user.type(screen.getByLabelText('search'), 'abc')
    await user.click(screen.getByRole('link', { name: 'open' }))

    expect(await screen.findByTestId('echo')).toBeInTheDocument()
    //The debounce (100 ms) expires while the list is still fading out (250 ms).
    await new Promise((resolve) => setTimeout(resolve, 400))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/tasks/1')
    })
    expect(router.state.location.search).toBe('')
    expect(screen.getByTestId('echo')).toHaveTextContent(/^\/tasks\/1$/)
  })
})
