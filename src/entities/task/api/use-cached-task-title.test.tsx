import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { taskKeys } from './task'
import { useCachedTaskTitle } from './use-cached-task-title'

const params = {
  pageIndex: 0,
  pageSize: 10,
  search: '',
  sort: { id: 'status', desc: false },
  statuses: [],
} as const
const page = (rows: { id: string; title: string }[]) => ({ rows, total: rows.length })

function setup(id: string, seed: (qc: QueryClient) => void) {
  const queryClient = new QueryClient()
  seed(queryClient)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return renderHook(() => useCachedTaskTitle(id), { wrapper }).result.current
}

describe('useCachedTaskTitle', () => {
  it('finds the title in an object task list', () => {
    const title = setup('t2', (qc) => {
      qc.setQueryData(
        taskKeys.byObject('o1', params),
        page([
          { id: 't1', title: 'A' },
          { id: 't2', title: 'B' },
        ]),
      )
    })
    expect(title).toBe('B')
  })

  it('finds the title in "my tasks"', () => {
    const title = setup('t1', (qc) => {
      qc.setQueryData(taskKeys.mine('u1', params), page([{ id: 't1', title: 'Mine' }]))
    })
    expect(title).toBe('Mine')
  })

  it('returns undefined when no list has the task', () => {
    expect(
      setup('t9', (qc) => qc.setQueryData(taskKeys.byObject('o1', params), page([]))),
    ).toBeUndefined()
  })

  it('ignores the history cache of the same task', () => {
    const title = setup('t1', (qc) => {
      qc.setQueryData(taskKeys.history('t1'), [{ id: 't1', title: 'not a task' }])
    })
    expect(title).toBeUndefined()
  })
})
