import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'

import { useTableUrlState } from '../use-table-url-state'
import { useDebouncedSearch } from './use-debounced-search'

const DELAY = 50

function setup(initial: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  )
  return renderHook(
    () => {
      const state = useTableUrlState({ pageSizes: [10] })
      return { state, applied: useDebouncedSearch(state, DELAY), location: useLocation() }
    },
    { wrapper },
  )
}

describe('useDebouncedSearch', () => {
  it('returns the URL search at once on the first render', () => {
    const { result } = setup('/x?q=abc&page=2')
    expect(result.current.applied).toBe('abc')
    expect(result.current.location.search).toBe('?q=abc&page=2')
  })

  it('applies the typed search after the pause', async () => {
    const { result } = setup('/x')
    act(() => {
      result.current.state.onGlobalFilterChange('abc')
    })
    expect(result.current.applied).toBe('')
    await waitFor(() => {
      expect(result.current.applied).toBe('abc')
    })
  })

  it('keeps a page chosen while the search was still pending', async () => {
    const { result } = setup('/x')
    act(() => {
      result.current.state.onGlobalFilterChange('abc')
    })
    act(() => {
      result.current.state.onPaginationChange({ pageIndex: 1, pageSize: 10 })
    })
    expect(result.current.location.search).toBe('?q=abc&page=2')
    await waitFor(() => {
      expect(result.current.applied).toBe('abc')
    })
    await new Promise((resolve) => setTimeout(resolve, DELAY * 2))
    expect(result.current.location.search).toBe('?q=abc&page=2')
  })
})
