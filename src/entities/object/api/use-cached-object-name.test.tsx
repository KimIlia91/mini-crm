import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { objectKeys } from './object'
import { useCachedObjectName } from './use-cached-object-name'

function setup(id: string, rows?: { id: string; name: string }[]) {
  const queryClient = new QueryClient()
  if (rows) {
    queryClient.setQueryData(
      objectKeys.list({
        pageIndex: 0,
        pageSize: 10,
        search: '',
        sort: { id: 'name', desc: false },
      }),
      { rows, total: rows.length },
    )
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return renderHook(() => useCachedObjectName(id), { wrapper }).result.current
}

describe('useCachedObjectName', () => {
  it('returns the name from the loaded list', () => {
    expect(
      setup('o2', [
        { id: 'o1', name: 'A' },
        { id: 'o2', name: 'B' },
      ]),
    ).toBe('B')
  })

  it('returns undefined without a list or row', () => {
    expect(setup('o1')).toBeUndefined()
    expect(setup('o9', [{ id: 'o1', name: 'A' }])).toBeUndefined()
  })
})
