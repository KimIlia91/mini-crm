import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SessionContext } from '@/shared/auth'

import { useViewerState } from './use-viewer'

interface ProfileResult {
  data: unknown
  error: { message: string } | null
}

const fake = vi.hoisted((): { profile: ProfileResult } => ({
  profile: { data: null, error: null },
}))

vi.mock('@/shared/api', () => ({
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

const OK: ProfileResult = {
  data: { id: 'u1', role: 'executor', full_name: 'Иван', must_change_password: false },
  error: null,
}
const FAILED: ProfileResult = { data: null, error: { message: 'network' } }

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <SessionContext value={{ status: 'signed-in', userId: 'u1' }}>{children}</SessionContext>
    </QueryClientProvider>
  )
  return { queryClient, ...renderHook(() => useViewerState(), { wrapper }) }
}

describe('useViewerState', () => {
  beforeEach(() => {
    fake.profile = OK
  })

  it('maps the profile row to a viewer', async () => {
    const { result } = setup()
    expect(result.current.status).toBe('loading')
    await waitFor(() => {
      expect(result.current).toEqual({
        status: 'ready',
        viewer: { id: 'u1', role: 'executor', fullName: 'Иван', mustChangePassword: false },
      })
    })
  })

  it('reports an error when the first load fails', async () => {
    fake.profile = FAILED
    const { result } = setup()
    await waitFor(() => {
      expect(result.current.status).toBe('error')
    })
  })

  it('keeps the loaded viewer when a background refetch fails', async () => {
    const { result, queryClient } = setup()
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    fake.profile = FAILED
    await act(async () => {
      await queryClient.refetchQueries()
    })
    expect(result.current.status).toBe('ready')
  })
})
