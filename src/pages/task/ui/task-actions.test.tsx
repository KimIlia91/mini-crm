import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { transitionKeys, type TaskStatus, type TransitionRule } from '@/entities/task'

import { expectNoAxeViolations } from '../../../../tests/setup/axe'
import { TaskActions } from './task-actions'

const api = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('@/shared/api', () => ({
  getSupabaseClient: () => ({ rpc: api.rpc }),
}))

const rules: TransitionRule[] = [
  { from_status: 'new', to_status: 'in_progress', actor_role: 'executor', comment_required: false },
  {
    from_status: 'in_progress',
    to_status: 'in_review',
    actor_role: 'executor',
    comment_required: false,
  },
  {
    from_status: 'in_review',
    to_status: 'accepted',
    actor_role: 'manager',
    comment_required: false,
  },
  { from_status: 'in_review', to_status: 'rework', actor_role: 'manager', comment_required: true },
  {
    from_status: 'rework',
    to_status: 'in_progress',
    actor_role: 'executor',
    comment_required: false,
  },
]

const EXECUTOR = { id: 'exec-1', role: 'executor' } as const
const MANAGER = { id: 'mgr-1', role: 'manager' } as const

function renderActions(
  status: TaskStatus,
  viewer: { id: string; role: 'manager' | 'executor' },
  assigneeId = 'exec-1',
) {
  // Rules are seeded in the cache (staleTime Infinity), so no request is made.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
  })
  queryClient.setQueryData(transitionKeys.all, rules)
  const ui = (current: TaskStatus) => (
    <QueryClientProvider client={queryClient}>
      <TaskActions task={{ id: 't1', status: current, assignee_id: assigneeId }} viewer={viewer} />
    </QueryClientProvider>
  )
  const view = render(ui(status))
  return {
    ...view,
    queryClient,
    setStatus: (next: TaskStatus) => {
      view.rerender(ui(next))
    },
  }
}

function buttonNames() {
  return screen.queryAllByRole('button').map((button) => button.textContent)
}

describe('TaskActions', () => {
  beforeEach(() => {
    api.rpc.mockReset()
    api.rpc.mockResolvedValue({ error: null })
  })

  it('shows the executor only the actions of the assigned task in its status', async () => {
    const { container } = renderActions('new', EXECUTOR)
    expect(buttonNames()).toEqual(['Взять в работу'])
    await expectNoAxeViolations(container)
  })

  it('shows nothing to an executor who is not the assignee', () => {
    renderActions('new', EXECUTOR, 'someone-else')
    expect(buttonNames()).toEqual([])
  })

  it('shows the manager accept and rework on a task in review, not executor actions', () => {
    renderActions('in_review', MANAGER)
    expect(buttonNames()).toEqual(['Принять', 'Вернуть на доработку'])
  })

  it.each<TaskStatus>(['new', 'in_progress', 'accepted', 'rework'])(
    'shows the manager no actions in status %s',
    (status) => {
      renderActions(status, MANAGER)
      expect(buttonNames()).toEqual([])
    },
  )

  it('performs a one-click transition without a comment', async () => {
    renderActions('new', EXECUTOR)
    await userEvent.click(screen.getByRole('button', { name: 'Взять в работу' }))
    await vi.waitFor(() => {
      expect(api.rpc).toHaveBeenCalledWith('change_task_status', {
        p_task_id: 't1',
        p_to_status: 'in_progress',
        p_comment: undefined,
      })
    })
  })

  it('blocks the rework dialog submit without a comment', async () => {
    renderActions('in_review', MANAGER)
    await userEvent.click(screen.getByRole('button', { name: 'Вернуть на доработку' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Вернуть на доработку' }),
    )
    expect(dialog).toBeInTheDocument()
    expect(await screen.findByText('Укажите комментарий')).toBeInTheDocument()
    expect(api.rpc).not.toHaveBeenCalled()
  })

  it('keeps the open rework comment when a background refetch of the rules fails', async () => {
    const { queryClient } = renderActions('in_review', MANAGER)
    await userEvent.click(screen.getByRole('button', { name: 'Вернуть на доработку' }))
    await userEvent.type(await screen.findByLabelText('Комментарий'), 'Нет фото')

    // The mocked client has no `from`, so the refetch fails while the cached rules stay.
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: transitionKeys.all })
      // TanStack Query notifies observers on the next macrotask.
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(queryClient.getQueryState(transitionKeys.all)?.status).toBe('error')

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByLabelText('Комментарий')).toHaveValue('Нет фото')
  })

  it('treats a whitespace-only comment as empty', async () => {
    renderActions('in_review', MANAGER)
    await userEvent.click(screen.getByRole('button', { name: 'Вернуть на доработку' }))
    await userEvent.type(await screen.findByLabelText('Комментарий'), '   ')
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Вернуть на доработку' }),
    )
    expect(await screen.findByText('Укажите комментарий')).toBeInTheDocument()
    expect(api.rpc).not.toHaveBeenCalled()
  })

  it('sends rework with the trimmed comment', async () => {
    renderActions('in_review', MANAGER)
    await userEvent.click(screen.getByRole('button', { name: 'Вернуть на доработку' }))
    await userEvent.type(await screen.findByLabelText('Комментарий'), '  Нет фото  ')
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Вернуть на доработку' }),
    )
    await vi.waitFor(() => {
      expect(api.rpc).toHaveBeenCalledWith('change_task_status', {
        p_task_id: 't1',
        p_to_status: 'rework',
        p_comment: 'Нет фото',
      })
    })
  })

  it('keeps the error visible when no actions remain after the status changed', async () => {
    api.rpc.mockResolvedValue({ error: { code: 'P0001', message: 'transition_not_allowed' } })
    const { setStatus } = renderActions('in_review', MANAGER)
    await userEvent.click(screen.getByRole('button', { name: 'Вернуть на доработку' }))
    await userEvent.type(await screen.findByLabelText('Комментарий'), 'Нет фото')
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Вернуть на доработку' }),
    )
    await vi.waitFor(() => {
      expect(api.rpc).toHaveBeenCalled()
    })
    // Another manager accepted the task meanwhile; the refetch removes the rework action.
    setStatus('accepted')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Действие недоступно: статус задачи изменился',
    )
    expect(buttonNames()).toEqual([])
  })

  it('explains a stale status when the database rejects the transition', async () => {
    api.rpc.mockResolvedValue({ error: { code: 'P0001', message: 'transition_not_allowed' } })
    renderActions('new', EXECUTOR)
    await userEvent.click(screen.getByRole('button', { name: 'Взять в работу' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Действие недоступно: статус задачи изменился',
    )
  })
})
