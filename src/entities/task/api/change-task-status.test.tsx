import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useChangeTaskStatus } from './change-task-status'
import { taskKeys } from './task'

const api = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('@/shared/api', () => ({
  getSupabaseClient: () => ({ rpc: api.rpc }),
}))

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { invalidate, ...renderHook(() => useChangeTaskStatus(), { wrapper }) }
}

describe('useChangeTaskStatus', () => {
  beforeEach(() => {
    api.rpc.mockReset()
  })

  it('invalidates task queries after success', async () => {
    api.rpc.mockResolvedValue({ error: null })
    const { result, invalidate } = setup()
    act(() => {
      result.current.mutate({ taskId: 't1', toStatus: 'in_progress' })
    })
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: taskKeys.all })
    })
  })

  it('still invalidates (refetches stale data) when the database rejects the transition', async () => {
    api.rpc.mockResolvedValue({ error: { code: 'P0001', message: 'transition_not_allowed' } })
    const { result, invalidate } = setup()
    act(() => {
      result.current.mutate({ taskId: 't1', toStatus: 'in_progress' })
    })
    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: taskKeys.all })
  })
})
