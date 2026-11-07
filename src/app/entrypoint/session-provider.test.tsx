import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthEvent } from '@/shared/api'
import { useSession } from '@/shared/auth'

import { SessionProvider } from './session-provider'

type Listener = (event: AuthEvent, userId: string | null) => void

const auth = vi.hoisted(() => ({ listener: null as Listener | null, unsubscribe: vi.fn() }))

vi.mock('@/shared/api', () => ({
  subscribeToAuthChanges: (listener: Listener) => {
    auth.listener = listener
    return auth.unsubscribe
  },
}))

function emit(event: AuthEvent, userId: string | null) {
  const listener = auth.listener
  if (!listener) throw new Error('No auth listener registered')
  act(() => {
    listener(event, userId)
  })
}

function Status() {
  const session = useSession()
  return <p>{`${session.status}:${session.userId ?? 'none'}`}</p>
}

function setup() {
  const queryClient = new QueryClient()
  queryClient.setQueryData(['secret'], 'user-a-data')
  const { unmount } = render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <Status />
      </SessionProvider>
    </QueryClientProvider>,
  )
  return { queryClient, unmount }
}

describe('SessionProvider', () => {
  beforeEach(() => {
    auth.unsubscribe.mockClear()
  })

  it('starts in loading and reflects the initial session', () => {
    setup()
    expect(screen.getByText('loading:none')).toBeInTheDocument()
    emit('INITIAL_SESSION', 'user-a')
    expect(screen.getByText('signed-in:user-a')).toBeInTheDocument()
  })

  it('clears the query cache synchronously on sign-out', () => {
    const { queryClient } = setup()
    emit('INITIAL_SESSION', 'user-a')
    expect(queryClient.getQueryData(['secret'])).toBe('user-a-data')

    emit('SIGNED_OUT', null)
    expect(queryClient.getQueryData(['secret'])).toBeUndefined()
    expect(screen.getByText('signed-out:none')).toBeInTheDocument()
  })

  it('clears the query cache when the user changes without a sign-out', () => {
    const { queryClient } = setup()
    emit('INITIAL_SESSION', 'user-a')
    emit('SIGNED_IN', 'user-b')
    expect(queryClient.getQueryData(['secret'])).toBeUndefined()
    expect(screen.getByText('signed-in:user-b')).toBeInTheDocument()
  })

  it('keeps the cache on token refresh and repeated events of the same user', () => {
    const { queryClient } = setup()
    emit('INITIAL_SESSION', 'user-a')
    emit('TOKEN_REFRESHED', 'user-a')
    emit('SIGNED_IN', 'user-a')
    expect(queryClient.getQueryData(['secret'])).toBe('user-a-data')
  })

  describe('remembered list states', () => {
    const KEYS = ['mini-crm:list:objects', 'mini-crm:list:opened:objects']

    function seed() {
      for (const key of KEYS) window.sessionStorage.setItem(key, 'x')
      window.sessionStorage.setItem('unrelated', 'keep')
    }

    afterEach(() => {
      window.sessionStorage.clear()
    })

    it('are dropped on sign-out', () => {
      setup()
      emit('INITIAL_SESSION', 'user-a')
      seed()
      emit('SIGNED_OUT', null)
      for (const key of KEYS) expect(window.sessionStorage.getItem(key)).toBeNull()
      expect(window.sessionStorage.getItem('unrelated')).toBe('keep')
    })

    it('are dropped when another user signs in', () => {
      setup()
      emit('INITIAL_SESSION', 'user-a')
      seed()
      emit('SIGNED_IN', 'user-b')
      for (const key of KEYS) expect(window.sessionStorage.getItem(key)).toBeNull()
    })

    it('are kept on token refresh and repeated events of the same user', () => {
      setup()
      emit('INITIAL_SESSION', 'user-a')
      seed()
      emit('TOKEN_REFRESHED', 'user-a')
      emit('SIGNED_IN', 'user-a')
      for (const key of KEYS) expect(window.sessionStorage.getItem(key)).toBe('x')
    })
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = setup()
    expect(auth.unsubscribe).not.toHaveBeenCalled()
    unmount()
    expect(auth.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
