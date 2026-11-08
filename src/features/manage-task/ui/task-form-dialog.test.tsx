import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { profileQueries } from '@/entities/profile'

import { expectNoAxeViolations } from '../../../../tests/setup/axe'
import { TaskFormDialog } from './task-form-dialog'

interface Result {
  data: unknown
  error: { code?: string; message: string } | null
}

const db = vi.hoisted(() => {
  const results: Record<string, Result | Promise<Result>> = {}
  const writes: unknown[] = []
  return { results, writes }
})

vi.mock('@/shared/api', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        abortSignal: () => builder,
        single: () => builder,
        insert: (values: unknown) => {
          db.writes.push(values)
          return builder
        },
        update: (values: unknown) => {
          db.writes.push(values)
          return builder
        },
        then: (
          resolve: (value: Result | undefined) => unknown,
          reject: (reason: unknown) => unknown,
        ) => Promise.resolve(db.results[table]).then(resolve, reject),
      }
      return builder
    },
  }),
}))

const EXECUTOR_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const EXECUTORS: Result = {
  data: [{ id: EXECUTOR_ID, full_name: 'Иван Исполнителев' }],
  error: null,
}

function renderDialog(props: Parameters<typeof TaskFormDialog>[0]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TaskFormDialog {...props} />
    </QueryClientProvider>,
  )
  return { ...view, queryClient }
}

async function openCreate() {
  renderDialog({ mode: 'create', objectId: 'o1' })
  await userEvent.click(screen.getByRole('button', { name: 'Добавить задачу' }))
  return screen.findByRole('dialog')
}

describe('TaskFormDialog', () => {
  beforeEach(() => {
    db.results = {}
    db.writes = []
  })

  it('has no accessibility violations when open', async () => {
    db.results.profiles = EXECUTORS
    await openCreate()
    expect(await screen.findByRole('combobox', { name: 'Исполнитель' })).toBeInTheDocument()
    await expectNoAxeViolations(document.body)
  })

  it('blocks submit while executors are loading', async () => {
    db.results.profiles = new Promise<Result>(() => undefined)
    const dialog = await openCreate()
    expect(within(dialog).getByRole('button', { name: 'Создать' })).toBeDisabled()
  })

  it('offers a retry when executors fail to load', async () => {
    db.results.profiles = { data: null, error: { code: 'XX000', message: 'boom' } }
    const dialog = await openCreate()
    expect(await within(dialog).findByText(/Не удалось загрузить исполнителей/)).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Повторить' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Создать' })).toBeDisabled()
  })

  it('keeps the assignee select when a background refetch of executors fails', async () => {
    db.results.profiles = EXECUTORS
    const { queryClient } = renderDialog({ mode: 'create', objectId: 'o1' })
    await userEvent.click(screen.getByRole('button', { name: 'Добавить задачу' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('combobox', { name: 'Исполнитель' })).toBeInTheDocument()

    db.results.profiles = { data: null, error: { code: 'XX000', message: 'boom' } }
    await act(async () => {
      await queryClient.invalidateQueries()
      // TanStack Query notifies observers on the next macrotask.
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(queryClient.getQueryState(profileQueries.executors().queryKey)?.status).toBe('error')

    expect(within(dialog).getByRole('combobox', { name: 'Исполнитель' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Создать' })).toBeEnabled()
  })

  it('shows an empty state when there are no executors', async () => {
    db.results.profiles = { data: [], error: null }
    const dialog = await openCreate()
    expect(await within(dialog).findByText('Нет доступных исполнителей')).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Создать' })).toBeDisabled()
  })

  it('validates required fields without sending a request', async () => {
    db.results.profiles = EXECUTORS
    const dialog = await openCreate()
    expect(await within(dialog).findByRole('combobox', { name: 'Исполнитель' })).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать' }))
    expect(await within(dialog).findByText('Введите название')).toBeVisible()
    expect(within(dialog).getByText('Выберите исполнителя', { selector: 'p' })).toBeVisible()
    expect(db.writes).toEqual([])
  })

  it('creates a task and closes the dialog', async () => {
    db.results.profiles = EXECUTORS
    db.results.tasks = { data: { id: 't1' }, error: null }
    const dialog = await openCreate()
    await userEvent.type(within(dialog).getByLabelText('Название'), '  Проверить  ')
    await userEvent.click(await within(dialog).findByRole('combobox', { name: 'Исполнитель' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Иван Исполнителев' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать' }))
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(db.writes).toEqual([
      { object_id: 'o1', title: 'Проверить', description: '', assignee_id: EXECUTOR_ID },
    ])
  })

  it('maps assignee_not_executor and keeps the input', async () => {
    db.results.profiles = EXECUTORS
    db.results.tasks = { data: null, error: { code: 'P0001', message: 'assignee_not_executor' } }
    const dialog = await openCreate()
    await userEvent.type(within(dialog).getByLabelText('Название'), 'Проверить')
    await userEvent.click(await within(dialog).findByRole('combobox', { name: 'Исполнитель' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Иван Исполнителев' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Исполнителем может быть только исполнитель',
    )
    expect(within(dialog).getByLabelText('Название')).toHaveValue('Проверить')
  })

  it('maps PGRST116 (update affected no rows) when editing', async () => {
    db.results.profiles = EXECUTORS
    db.results.tasks = { data: null, error: { code: 'PGRST116', message: '0 rows' } }
    renderDialog({
      mode: 'edit',
      task: { id: 't1', title: 'Старое', description: 'Описание', assigneeId: EXECUTOR_ID },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Редактировать' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Название')).toHaveValue('Старое')
    expect(await within(dialog).findByRole('combobox', { name: 'Исполнитель' })).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Задача недоступна для редактирования',
    )
    expect(db.writes).toEqual([
      { title: 'Старое', description: 'Описание', assignee_id: EXECUTOR_ID },
    ])
  })
})
