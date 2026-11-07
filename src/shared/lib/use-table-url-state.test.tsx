import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation, useNavigationType } from 'react-router'
import { describe, expect, it } from 'vitest'

import { useDataTable } from './use-data-table'
import { useTableUrlState } from './use-table-url-state'

const options = {
  pageSizes: [10, 20, 50],
  statusValues: ['new', 'rework', 'accepted'],
} as const

function setup(initial: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  )
  return renderHook(
    () => ({
      state: useTableUrlState(options),
      location: useLocation(),
      navigationType: useNavigationType(),
    }),
    { wrapper },
  )
}

describe('useTableUrlState', () => {
  it('uses defaults for an empty URL', () => {
    const { result } = setup('/objects')
    expect(result.current.state.globalFilter).toBe('')
    expect(result.current.state.columnFilters).toEqual([])
    expect(result.current.state.pagination).toEqual({ pageIndex: 0, pageSize: 10 })
  })

  it('reads q, status, page and size', () => {
    const { result } = setup('/x?q=склад&status=new,rework&page=3&size=20')
    expect(result.current.state.globalFilter).toBe('склад')
    expect(result.current.state.columnFilters).toEqual([{ id: 'status', value: ['new', 'rework'] }])
    expect(result.current.state.pagination).toEqual({ pageIndex: 2, pageSize: 20 })
  })

  it.each([
    ['page=0'],
    ['page=-1'],
    ['page=abc'],
    ['page=2.5'],
    ['page=1e3'],
    ['page='],
    ['page=99999999999'],
  ])('falls back to the first page for %s', (query) => {
    const { result } = setup(`/x?${query}`)
    expect(result.current.state.pagination.pageIndex).toBe(0)
  })

  it.each([['size=7'], ['size=0'], ['size=abc'], ['size=1000']])(
    'falls back to the default size for %s',
    (query) => {
      const { result } = setup(`/x?${query}`)
      expect(result.current.state.pagination.pageSize).toBe(10)
    },
  )

  it('drops unknown and duplicate statuses', () => {
    const { result } = setup('/x?status=hacked,new,new,,')
    expect(result.current.state.columnFilters).toEqual([{ id: 'status', value: ['new'] }])
  })

  it('ignores a status param that contains only unknown values', () => {
    const { result } = setup('/x?status=hacked')
    expect(result.current.state.columnFilters).toEqual([])
  })

  it('writes the search with replace, resets the page and omits an empty value', () => {
    const { result } = setup('/x?page=3')
    act(() => {
      result.current.state.onGlobalFilterChange('abc')
    })
    expect(result.current.location.search).toBe('?q=abc')
    expect(result.current.navigationType).toBe('REPLACE')
    act(() => {
      result.current.state.onGlobalFilterChange('')
    })
    expect(result.current.location.search).toBe('')
  })

  it('writes the status facet with push and resets the page', () => {
    const { result } = setup('/x?page=2&q=a')
    act(() => {
      result.current.state.onColumnFiltersChange([{ id: 'status', value: ['accepted', 'new'] }])
    })
    expect(result.current.location.search).toBe('?q=a&status=accepted%2Cnew')
    expect(result.current.navigationType).toBe('PUSH')
    act(() => {
      result.current.state.onColumnFiltersChange([])
    })
    expect(result.current.location.search).toBe('?q=a')
  })

  it('writes the page, keeps the default size out of the URL and resets the page on size change', () => {
    const { result } = setup('/x')
    act(() => {
      result.current.state.onPaginationChange({ pageIndex: 2, pageSize: 10 })
    })
    expect(result.current.location.search).toBe('?page=3')
    act(() => {
      result.current.state.onPaginationChange((old) => ({ ...old, pageSize: 50 }))
    })
    expect(result.current.location.search).toBe('?size=50')
    act(() => {
      result.current.state.onPaginationChange({ pageIndex: 0, pageSize: 10 })
    })
    expect(result.current.location.search).toBe('')
  })
})

describe('useClampPageIndex (through useDataTable)', () => {
  const columns = [{ accessorKey: 'name' }]
  interface Row {
    name: string
  }
  const pageRows = (count: number): Row[] =>
    Array.from({ length: Math.min(count, 10) }, (_, index) => ({ name: `row ${String(index)}` }))

  function render(initial: string, initialProps: { rowCount: number; isLoading: boolean }) {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
    )
    return renderHook(
      ({ rowCount, isLoading }: { rowCount: number; isLoading: boolean }) => {
        const urlState = useTableUrlState(options)
        return {
          table: useDataTable({
            data: pageRows(rowCount),
            columns,
            rowCount,
            urlState,
            isLoading,
          }),
          location: useLocation(),
          navigationType: useNavigationType(),
        }
      },
      { wrapper, initialProps },
    )
  }

  it('moves a page past the end to the last page, replacing the history entry', () => {
    const { result } = render('/x?page=99', { rowCount: 25, isLoading: false })
    expect(result.current.location.search).toBe('?page=3')
    expect(result.current.navigationType).toBe('REPLACE')
  })

  it('drops the page when there is no data at all', () => {
    const { result } = render('/x?page=5&q=a', { rowCount: 0, isLoading: false })
    expect(result.current.location.search).toBe('?q=a')
    expect(result.current.navigationType).toBe('REPLACE')
  })

  it('keeps the page from the URL while the data is still loading', () => {
    const { result, rerender } = render('/x?page=2', { rowCount: 0, isLoading: true })
    expect(result.current.location.search).toBe('?page=2')
    rerender({ rowCount: 15, isLoading: false })
    expect(result.current.location.search).toBe('?page=2')
    expect(result.current.table.getState().pagination.pageIndex).toBe(1)
  })

  it('does not navigate when the page is within range', () => {
    const { result } = render('/x?page=3', { rowCount: 25, isLoading: false })
    expect(result.current.location.search).toBe('?page=3')
    expect(result.current.navigationType).toBe('POP')
  })
})
