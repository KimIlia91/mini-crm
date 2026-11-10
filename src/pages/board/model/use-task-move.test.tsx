import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TransitionRule } from '@/entities/task'

import type { MoveTask } from './board'
import { useTaskMove } from './use-task-move'

const api = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('@/shared/api', () => ({
  getSupabaseClient: () => ({ rpc: api.rpc }),
}))

const RULES: TransitionRule[] = [
  { from_status: 'new', to_status: 'in_progress', actor_role: 'executor', comment_required: false },
  {
    from_status: 'in_review',
    to_status: 'accepted',
    actor_role: 'manager',
    comment_required: false,
  },
  { from_status: 'in_review', to_status: 'rework', actor_role: 'manager', comment_required: true },
]

const MANAGER = { id: 'mgr-1', role: 'manager' } as const
const EXECUTOR = { id: 'exec-1', role: 'executor' } as const

const reviewTask: MoveTask = {
  id: 't-review',
  title: 'На проверке',
  status: 'in_review',
  assignee_id: 'exec-1',
}
const newTask: MoveTask = { id: 't-new', title: 'Новая', status: 'new', assignee_id: 'exec-1' }

function setup(viewer: { id: string; role: 'manager' | 'executor' } = MANAGER) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return renderHook(() => useTaskMove({ rules: RULES, viewer }), { wrapper })
}

function deferred() {
  let resolve: (value: { error: unknown }) => void = () => undefined
  const promise = new Promise<{ error: unknown }>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('useTaskMove', () => {
  beforeEach(() => {
    api.rpc.mockReset()
    api.rpc.mockResolvedValue({ error: null })
  })

  it('sends a rule without a comment at once', async () => {
    const { result } = setup(EXECUTOR)
    act(() => {
      result.current.request(newTask, 'in_progress')
    })
    await waitFor(() => {
      expect(result.current.lastMoved).toEqual({
        id: 't-new',
        title: 'Новая',
        to: 'in_progress',
      })
    })
    expect(api.rpc).toHaveBeenCalledTimes(1)
    expect(api.rpc).toHaveBeenCalledWith('change_task_status', {
      p_task_id: 't-new',
      p_to_status: 'in_progress',
      p_comment: undefined,
    })
  })

  it('opens the comment dialog for comment_required and does not call rpc', () => {
    const { result } = setup()
    act(() => {
      result.current.request(reviewTask, 'rework')
    })
    expect(result.current.commentTarget).toEqual({ task: reviewTask, to: 'rework' })
    expect(api.rpc).not.toHaveBeenCalled()
    expect(result.current.isPending).toBe(false)
  })

  it('sends the comment from the dialog and closes it on success', async () => {
    const { result } = setup()
    act(() => {
      result.current.request(reviewTask, 'rework')
    })
    act(() => {
      result.current.submitComment('Нет фото')
    })
    await waitFor(() => {
      expect(result.current.commentTarget).toBeNull()
    })
    expect(api.rpc).toHaveBeenCalledWith('change_task_status', {
      p_task_id: 't-review',
      p_to_status: 'rework',
      p_comment: 'Нет фото',
    })
    expect(result.current.lastMoved?.to).toBe('rework')
  })

  it('closing the dialog sends nothing and forgets the target', () => {
    const { result } = setup()
    act(() => {
      result.current.request(reviewTask, 'rework')
    })
    act(() => {
      result.current.closeComment()
    })
    expect(result.current.commentTarget).toBeNull()
    expect(api.rpc).not.toHaveBeenCalled()
  })

  it('a second request while the first is pending sends only one rpc', async () => {
    const gate = deferred()
    api.rpc.mockReturnValue(gate.promise)
    const { result } = setup()
    act(() => {
      result.current.request(reviewTask, 'accepted')
    })
    await waitFor(() => {
      expect(result.current.isPending).toBe(true)
    })
    act(() => {
      result.current.request(reviewTask, 'accepted')
      result.current.request({ ...reviewTask, id: 'other' }, 'accepted')
    })
    expect(api.rpc).toHaveBeenCalledTimes(1)
    expect(result.current.pending).toEqual({ id: 't-review', to: 'accepted' })
    await act(async () => {
      gate.resolve({ error: null })
      await gate.promise
    })
    await waitFor(() => {
      expect(result.current.isPending).toBe(false)
    })
    expect(api.rpc).toHaveBeenCalledTimes(1)
  })

  it('ignores a move the rules do not allow', () => {
    const { result } = setup(EXECUTOR)
    act(() => {
      result.current.request(reviewTask, 'accepted')
    })
    expect(api.rpc).not.toHaveBeenCalled()
    expect(result.current.commentTarget).toBeNull()
    expect(result.current.pending).toBeNull()
  })

  it('keeps the error with the task title until the next action', async () => {
    api.rpc.mockResolvedValueOnce({ error: { code: 'P0001', message: 'transition_not_allowed' } })
    const { result } = setup()
    act(() => {
      result.current.request(reviewTask, 'accepted')
    })
    await waitFor(() => {
      expect(result.current.bannerError).not.toBeNull()
    })
    expect(result.current.bannerError?.title).toBe('На проверке')
    expect(result.current.lastMoved).toBeNull()

    act(() => {
      result.current.request(reviewTask, 'accepted')
    })
    await waitFor(() => {
      expect(result.current.lastMoved?.to).toBe('accepted')
    })
    expect(result.current.bannerError).toBeNull()
    expect(api.rpc).toHaveBeenCalledTimes(2)
  })

  it('dismissError clears the banner', async () => {
    api.rpc.mockResolvedValueOnce({ error: { code: 'P0001', message: 'task_not_found' } })
    const { result } = setup()
    act(() => {
      result.current.request(reviewTask, 'accepted')
    })
    await waitFor(() => {
      expect(result.current.bannerError).not.toBeNull()
    })
    act(() => {
      result.current.dismissError()
    })
    await waitFor(() => {
      expect(result.current.bannerError).toBeNull()
    })
  })

  it('a failure inside the comment dialog is a dialog error, not a banner, and the dialog stays open', async () => {
    api.rpc.mockResolvedValueOnce({ error: { code: 'P0001', message: 'transition_not_allowed' } })
    const { result } = setup()
    act(() => {
      result.current.request(reviewTask, 'rework')
    })
    act(() => {
      result.current.submitComment('Нет фото')
    })
    await waitFor(() => {
      expect(result.current.commentError).not.toBeNull()
    })
    expect(result.current.commentTarget).not.toBeNull()
    expect(result.current.bannerError).toBeNull()
  })

  it('a double submit of the comment sends one rpc', async () => {
    const gate = deferred()
    api.rpc.mockReturnValue(gate.promise)
    const { result } = setup()
    act(() => {
      result.current.request(reviewTask, 'rework')
    })
    act(() => {
      result.current.submitComment('Нет фото')
    })
    await waitFor(() => {
      expect(result.current.isPending).toBe(true)
    })
    act(() => {
      result.current.submitComment('Нет фото')
    })
    expect(api.rpc).toHaveBeenCalledTimes(1)
    await act(async () => {
      gate.resolve({ error: null })
      await gate.promise
    })
  })

  it('closing the comment dialog while the rpc is pending does not leave the hook stuck busy', async () => {
    const gate = deferred()
    api.rpc.mockReturnValueOnce(gate.promise)
    const { result } = setup()
    act(() => {
      result.current.request(reviewTask, 'rework')
    })
    act(() => {
      result.current.submitComment('x')
    })
    await waitFor(() => {
      expect(result.current.isPending).toBe(true)
    })
    act(() => {
      result.current.closeComment()
    })
    await act(async () => {
      gate.resolve({ error: null })
      await gate.promise
    })
    await act(async () => {
      result.current.request(reviewTask, 'accepted')
      await Promise.resolve()
    })
    expect(api.rpc).toHaveBeenCalledTimes(2)
    await waitFor(() => {
      expect(result.current.lastMoved?.to).toBe('accepted')
    })
  })

  it('two requests in one tick send exactly one rpc', async () => {
    const gate = deferred()
    api.rpc.mockReturnValue(gate.promise)
    const { result } = setup()
    await act(async () => {
      result.current.request(reviewTask, 'accepted')
      result.current.request({ ...reviewTask, id: 'other' }, 'accepted')
      await Promise.resolve()
    })
    expect(api.rpc).toHaveBeenCalledTimes(1)
    await act(async () => {
      gate.resolve({ error: null })
      await gate.promise
    })
    expect(api.rpc).toHaveBeenCalledTimes(1)
  })
})
