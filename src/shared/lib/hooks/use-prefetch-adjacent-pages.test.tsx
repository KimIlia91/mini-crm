import { QueryClient, QueryClientProvider, queryOptions } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { usePrefetchAdjacentPages } from './use-prefetch-adjacent-pages'

function setup(initial: { pageIndex: number; pageCount: number; isReady: boolean }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const fetchPage = vi.fn((index: number) => Promise.resolve({ index }))
  const optionsFor = (index: number) =>
    queryOptions({ queryKey: ['list', index], queryFn: () => fetchPage(index) })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const view = renderHook(
    (props: typeof initial) => {
      usePrefetchAdjacentPages({ ...props, optionsFor })
    },
    { wrapper, initialProps: initial },
  )
  return { queryClient, fetchPage, ...view }
}

describe('usePrefetchAdjacentPages', () => {
  it('loads the previous and the next page once the shown one is ready', async () => {
    const { queryClient, fetchPage } = setup({ pageIndex: 1, pageCount: 3, isReady: true })
    await waitFor(() => {
      expect(queryClient.getQueryData(['list', 0])).toEqual({ index: 0 })
      expect(queryClient.getQueryData(['list', 2])).toEqual({ index: 2 })
    })
    expect(fetchPage).not.toHaveBeenCalledWith(1)
  })

  it('requests nothing before the shown page has arrived', () => {
    const { fetchPage } = setup({ pageIndex: 1, pageCount: 3, isReady: false })
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('starts when the shown page arrives', async () => {
    const { fetchPage, rerender } = setup({ pageIndex: 1, pageCount: 3, isReady: false })
    rerender({ pageIndex: 1, pageCount: 3, isReady: true })
    await waitFor(() => {
      expect(fetchPage).toHaveBeenCalledTimes(2)
    })
  })

  it('does not go past the last page', async () => {
    const { fetchPage } = setup({ pageIndex: 2, pageCount: 3, isReady: true })
    await waitFor(() => {
      expect(fetchPage).toHaveBeenCalledWith(1)
    })
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('does not go before the first page', async () => {
    const { fetchPage } = setup({ pageIndex: 0, pageCount: 3, isReady: true })
    await waitFor(() => {
      expect(fetchPage).toHaveBeenCalledWith(1)
    })
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('requests nothing for a single page or an empty list', () => {
    expect(setup({ pageIndex: 0, pageCount: 1, isReady: true }).fetchPage).not.toHaveBeenCalled()
    expect(setup({ pageIndex: 0, pageCount: 0, isReady: true }).fetchPage).not.toHaveBeenCalled()
  })
})
