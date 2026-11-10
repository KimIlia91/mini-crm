import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_OBJECT_SORT, objectKeys } from '@/entities/object'
import { profileKeys, type Viewer } from '@/entities/profile'
import {
  taskKeys,
  transitionKeys,
  type BoardTaskRow,
  type TaskStatus,
  type TransitionRule,
} from '@/entities/task'
import { SessionContext } from '@/shared/auth'

import { expectNoAxeViolations } from '../../../../tests/setup/axe'
import { BOARD_STATUS_ORDER } from '../model/board'
import { BoardPage } from './board-page'

const api = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('@/shared/api', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/shared/api')),
  getSupabaseClient: () => ({
    rpc: api.rpc,
    from: () => {
      throw new Error('unexpected request: data is seeded in the cache')
    },
  }),
}))

const RULES: TransitionRule[] = [
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

function card(id: string, title: string, status: TaskStatus): BoardTaskRow {
  return {
    id,
    title,
    status,
    created_at: '2026-11-02T10:00:00Z',
    assignee_id: 'e1',
    object: { id: 'o1', name: 'Склад №1' },
    assignee: { id: 'e1', full_name: 'Иван Исполнителев' },
  }
}

const TASKS: BoardTaskRow[] = [
  card('t-new', 'Новая задача', 'new'),
  card('t-progress', 'Задача в работе', 'in_progress'),
  card('t-review', 'Задача на проверке', 'in_review'),
  card('t-rework', 'Задача на доработке', 'rework'),
  card('t-done', 'Принятая задача', 'accepted'),
]

function mockMedia(wide: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: wide,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
}

interface RenderOptions {
  role: Viewer['role']
  wide?: boolean
  tasks?: BoardTaskRow[]
  entry?: string
  unknownObject?: string
}

function renderBoard({
  role,
  wide = true,
  tasks = TASKS,
  entry = '/board',
  unknownObject,
}: RenderOptions) {
  mockMedia(wide)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  const viewer: Viewer = {
    id: role === 'executor' ? 'e1' : 'm1',
    role,
    fullName: 'Тест',
    mustChangePassword: false,
  }
  queryClient.setQueryData(profileKeys.byId(viewer.id), viewer)
  queryClient.setQueryData(transitionKeys.all, RULES)
  if (unknownObject !== undefined) queryClient.setQueryData(objectKeys.detail(unknownObject), null)
  queryClient.setQueryData(
    objectKeys.list({ pageIndex: 0, pageSize: 100, search: '', sort: DEFAULT_OBJECT_SORT }),
    { rows: [{ id: 'o1', name: 'Склад №1', address: 'а', created_at: '2026-11-01' }], total: 1 },
  )
  for (const status of BOARD_STATUS_ORDER) {
    const rows = tasks.filter((task) => task.status === status)
    queryClient.setQueryData(taskKeys.board({ status, limit: 20 }), { rows, total: rows.length })
  }
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionContext value={{ status: 'signed-in', userId: viewer.id }}>
        <MemoryRouter initialEntries={[entry]}>
          <BoardPage />
        </MemoryRouter>
      </SessionContext>
    </QueryClientProvider>,
  )
  return { ...view, queryClient }
}

describe('BoardPage', () => {
  beforeEach(() => {
    api.rpc.mockReset()
    api.rpc.mockResolvedValue({ error: null })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('wide screen', () => {
    it('shows one h1 and five columns in workflow order with their totals', () => {
      renderBoard({ role: 'manager' })
      expect(screen.getByRole('heading', { level: 1, name: 'Доска задач' })).toBeInTheDocument()
      const region = screen.getByRole('region', { name: 'Колонки доски' })
      const headings = within(region).getAllByRole('heading', { level: 2 })
      expect(headings.map((h) => h.textContent)).toEqual([
        'Новая1',
        'В работе1',
        'На проверке1',
        'На доработке1',
        'Принята1',
      ])
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    })

    it('shows the cards inside their own column', () => {
      renderBoard({ role: 'manager' })
      const column = screen.getByRole('region', { name: /^Новая/ })
      expect(within(column).getByText('Новая задача')).toBeInTheDocument()
      expect(within(column).queryByText('Задача в работе')).not.toBeInTheDocument()
    })

    it('has no axe violations', async () => {
      const { container } = renderBoard({ role: 'manager' })
      await expectNoAxeViolations(container)
    })

    it('shows the manager accept and rework buttons only on the review card', () => {
      renderBoard({ role: 'manager' })
      expect(screen.getAllByRole('button', { name: 'Принять' })).toHaveLength(1)
      expect(screen.getAllByRole('button', { name: 'Вернуть на доработку' })).toHaveLength(1)
      expect(screen.queryByRole('button', { name: 'Взять в работу' })).not.toBeInTheDocument()
    })

    it('shows the executor only the buttons of own tasks', () => {
      renderBoard({ role: 'executor' })
      expect(screen.getAllByRole('button', { name: 'Взять в работу' })).toHaveLength(2)
      expect(screen.queryByRole('button', { name: 'Принять' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Вернуть на доработку' })).not.toBeInTheDocument()
    })

    it('shows no buttons to an executor for a foreign task', () => {
      renderBoard({
        role: 'executor',
        tasks: [{ ...card('t-x', 'Чужая', 'new'), assignee_id: 'someone-else' }],
      })
      expect(screen.getByText('Чужая')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Взять в работу' })).not.toBeInTheDocument()
    })

    it('sends a one-click move through rpc', async () => {
      renderBoard({ role: 'executor' })
      await userEvent.click(
        within(screen.getByRole('region', { name: /^Новая/ })).getByRole('button', {
          name: 'Взять в работу',
        }),
      )
      await vi.waitFor(() => {
        expect(api.rpc).toHaveBeenCalledWith('change_task_status', {
          p_task_id: 't-new',
          p_to_status: 'in_progress',
          p_comment: undefined,
        })
      })
      expect(api.rpc).toHaveBeenCalledTimes(1)
    })

    it('opens the comment dialog for rework without calling rpc, and Esc changes nothing', async () => {
      renderBoard({ role: 'manager' })
      await userEvent.click(screen.getByRole('button', { name: 'Вернуть на доработку' }))
      const dialog = await screen.findByRole('dialog', { name: 'Вернуть на доработку' })
      expect(within(dialog).getByLabelText('Комментарий')).toBeInTheDocument()
      expect(api.rpc).not.toHaveBeenCalled()
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(api.rpc).not.toHaveBeenCalled()
    })

    it('sends rework with the trimmed comment', async () => {
      renderBoard({ role: 'manager' })
      await userEvent.click(screen.getByRole('button', { name: 'Вернуть на доработку' }))
      const dialog = await screen.findByRole('dialog')
      await userEvent.type(within(dialog).getByLabelText('Комментарий'), '  Нет фото  ')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Вернуть на доработку' }))
      await vi.waitFor(() => {
        expect(api.rpc).toHaveBeenCalledWith('change_task_status', {
          p_task_id: 't-review',
          p_to_status: 'rework',
          p_comment: 'Нет фото',
        })
      })
    })

    it('shows a banner with the task title when the database rejects the move, card stays', async () => {
      api.rpc.mockResolvedValue({ error: { code: 'P0001', message: 'transition_not_allowed' } })
      renderBoard({ role: 'manager' })
      await userEvent.click(screen.getByRole('button', { name: 'Принять' }))
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Задача «Задача на проверке»')
      expect(alert).toHaveTextContent('Действие недоступно: статус задачи изменился')
      expect(screen.getByText('Задача на проверке')).toBeInTheDocument()
      await userEvent.click(within(alert).getByRole('button', { name: 'Закрыть' }))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('hides the object on cards when filtered by an object and shows the assignee to a manager', () => {
      renderBoard({ role: 'manager' })
      expect(screen.getAllByText('Склад №1').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Иван Исполнителев').length).toBeGreaterThan(0)
    })

    it('shows the manager empty state with a link to objects', () => {
      renderBoard({ role: 'manager', tasks: [] })
      expect(screen.getByText('Задачи создаются в карточке объекта')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'К объектам' })).toHaveAttribute('href', '/objects')
    })

    it('shows the executor empty state without a link to objects', () => {
      renderBoard({ role: 'executor', tasks: [] })
      expect(screen.getByText('Вам пока не назначили задачи')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'К объектам' })).not.toBeInTheDocument()
    })
  })

  describe('narrow screen', () => {
    it('shows five tabs with counts, a tabpanel, and no region of columns', () => {
      renderBoard({ role: 'manager', wide: false })
      const tabs = within(screen.getByRole('tablist', { name: 'Статусы задач' })).getAllByRole(
        'tab',
      )
      expect(tabs.map((tab) => tab.textContent)).toEqual([
        'Новая1',
        'В работе1',
        'На проверке1',
        'На доработке1',
        'Принята1',
      ])
      expect(screen.getByRole('tabpanel')).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Колонки доски' })).not.toBeInTheDocument()
    })

    it.each([
      ['manager', 'На проверке', 'Задача на проверке'],
      ['executor', 'В работе', 'Задача в работе'],
    ] as const)('%s starts on the column %s', (role, tab, title) => {
      renderBoard({ role, wide: false })
      expect(screen.getByRole('tab', { name: new RegExp(tab) })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(within(screen.getByRole('tabpanel')).getByText(title)).toBeInTheDocument()
    })

    it('follows the column from the URL and ignores an invalid one', () => {
      const { unmount } = renderBoard({
        role: 'manager',
        wide: false,
        entry: '/board?column=accepted',
      })
      expect(screen.getByRole('tab', { name: /Принята/ })).toHaveAttribute('aria-selected', 'true')
      unmount()
      renderBoard({ role: 'manager', wide: false, entry: '/board?column=bogus' })
      expect(screen.getByRole('tab', { name: /На проверке/ })).toHaveAttribute(
        'aria-selected',
        'true',
      )
    })

    it('switches the visible column with a click', async () => {
      renderBoard({ role: 'manager', wide: false })
      await userEvent.click(screen.getByRole('tab', { name: /Новая/ }))
      expect(within(screen.getByRole('tabpanel')).getByText('Новая задача')).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /Новая/ })).toHaveAttribute('aria-selected', 'true')
    })

    it('has no axe violations', async () => {
      const { container } = renderBoard({ role: 'manager', wide: false })
      await expectNoAxeViolations(container)
    })
  })

  describe('object filter in the URL', () => {
    it('treats a malformed object as no filter', () => {
      renderBoard({ role: 'manager', entry: '/board?object=not-a-uuid' })
      expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(5)
      expect(screen.queryByText('Объект не найден или недоступен')).not.toBeInTheDocument()
    })

    it('shows a message and a reset button for a valid but unknown object', async () => {
      const id = '0f0e0d0c-1111-4222-8333-444455556666'
      renderBoard({ role: 'manager', entry: `/board?object=${id}`, unknownObject: id })
      expect(await screen.findByText('Объект не найден или недоступен')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Показать все объекты' })).toBeInTheDocument()
    })
  })
})
