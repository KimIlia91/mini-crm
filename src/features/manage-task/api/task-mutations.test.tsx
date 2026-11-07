import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { objectKeys } from '@/entities/object'
import { taskKeys, transitionKeys } from '@/entities/task'

import { useCreateTask, useDeleteTask, useUpdateTask } from './task-mutations'

interface Result {
  data?: unknown
  error: unknown
}

const api = vi.hoisted<{ result: Result; calls: string[] }>(() => ({
  result: { data: null, error: null },
  calls: [],
}))

/** Awaitable chainable stand-in for a supabase-js query builder; records the chain. */
function createBuilder() {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: Result) => unknown) => Promise.resolve(api.result).then(resolve),
  }
  for (const method of ['insert', 'update', 'delete', 'select', 'eq']) {
    builder[method] = (...args: unknown[]) => {
      api.calls.push(`${method}(${args.map((a) => JSON.stringify(a)).join(',')})`)
      return builder
    }
  }
  builder.single = () => Promise.resolve(api.result)
  return builder
}

vi.mock('@/shared/api', () => ({
  getSupabaseClient: () => ({
    rpc: (fn: string, args: unknown) => {
      api.calls.push(`rpc(${fn},${JSON.stringify(args)})`)
      return Promise.resolve(api.result)
    },
    from: (table: string) => {
      api.calls.push(`from(${table})`)
      return createBuilder()
    },
  }),
}))

const listParams = {
  pageIndex: 0,
  pageSize: 10,
  search: '',
  sort: { id: 'status', desc: false },
  statuses: [],
} as const
const objectListParams = {
  pageIndex: 0,
  pageSize: 10,
  search: '',
  sort: { id: 'name', desc: false },
} as const

const keys = {
  byObject: taskKeys.byObject('o1', listParams),
  mine: taskKeys.mine('u1', listParams),
  detail: taskKeys.detail('t1'),
  history: taskKeys.history('t1'),
  otherDetail: taskKeys.detail('t2'),
  otherHistory: taskKeys.history('t2'),
  transitions: transitionKeys.all,
  objectList: objectKeys.list(objectListParams),
}
const allKeys = Object.values(keys)
const taskKeyList = [
  keys.byObject,
  keys.mine,
  keys.detail,
  keys.history,
  keys.otherDetail,
  keys.otherHistory,
]

function setup<T>(useHook: () => T) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } })
  for (const key of allKeys) queryClient.setQueryData(key, { seeded: true })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, ...renderHook(useHook, { wrapper }) }
}

function isInvalidated(queryClient: QueryClient, key: readonly unknown[]) {
  return queryClient.getQueryState(key)?.isInvalidated
}

/** Present in the cache and not marked stale. */
function untouched(queryClient: QueryClient, key: readonly unknown[]) {
  const state = queryClient.getQueryState(key)
  return state !== undefined && !state.isInvalidated
}

const assigneeId = '3f1c7a52-8d5e-4c53-9d0e-0a1b2c3d4e5f'
const formValues = { title: 'Проверить', description: 'Описание', assigneeId }

describe('task mutations and the query cache', () => {
  beforeEach(() => {
    api.result = { data: null, error: null }
    api.calls = []
  })

  describe('useCreateTask', () => {
    it('maps the form to columns and invalidates the task lists only', async () => {
      api.result = { data: { id: 't9' }, error: null }
      const { result, queryClient } = setup(() => useCreateTask())
      act(() => {
        result.current.mutate({ ...formValues, objectId: 'o1' })
      })
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })
      expect(result.current.data).toEqual({ id: 't9' })
      const row = {
        object_id: 'o1',
        title: 'Проверить',
        description: 'Описание',
        assignee_id: assigneeId,
      }
      expect(api.calls).toContain(`insert(${JSON.stringify(row)})`)
      for (const key of [keys.byObject, keys.mine]) {
        expect(isInvalidated(queryClient, key)).toBe(true)
      }
      for (const key of [keys.detail, keys.history]) expect(untouched(queryClient, key)).toBe(true)
      expect(untouched(queryClient, keys.transitions)).toBe(true)
      expect(untouched(queryClient, keys.objectList)).toBe(true)
    })

    it('passes the database error through and leaves the cache untouched', async () => {
      const dbError = { code: '42501', message: 'rls' }
      api.result = { data: null, error: dbError }
      const { result, queryClient } = setup(() => useCreateTask())
      act(() => {
        result.current.mutate({ ...formValues, objectId: 'o1' })
      })
      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })
      expect(result.current.error).toBe(dbError)
      for (const key of allKeys) expect(untouched(queryClient, key)).toBe(true)
    })
  })

  describe('useUpdateTask', () => {
    it('updates by id without object_id and invalidates all task queries only', async () => {
      api.result = { data: { id: 't1' }, error: null }
      const { result, queryClient } = setup(() => useUpdateTask())
      act(() => {
        result.current.mutate({ ...formValues, id: 't1' })
      })
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })
      expect(api.calls).toContain('eq("id","t1")')
      expect(api.calls.join('|')).not.toContain('object_id')
      for (const key of taskKeyList) expect(isInvalidated(queryClient, key)).toBe(true)
      expect(untouched(queryClient, keys.transitions)).toBe(true)
      expect(untouched(queryClient, keys.objectList)).toBe(true)
    })

    it('0 affected rows (PGRST116) surfaces as an error and does not touch the cache', async () => {
      const dbError = { code: 'PGRST116', message: '0 rows' }
      api.result = { data: null, error: dbError }
      const { result, queryClient } = setup(() => useUpdateTask())
      act(() => {
        result.current.mutate({ ...formValues, id: 't1' })
      })
      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })
      expect(result.current.error).toBe(dbError)
      for (const key of allKeys) expect(untouched(queryClient, key)).toBe(true)
    })
  })

  describe('useDeleteTask', () => {
    it('removes the deleted task detail and history, invalidates the task lists', async () => {
      api.result = { data: null, error: null }
      const { result, queryClient } = setup(() => useDeleteTask())
      act(() => {
        result.current.mutate('t1')
      })
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })
      expect(api.calls).toContain('rpc(delete_task,{"p_task_id":"t1"})')
      expect(queryClient.getQueryState(keys.detail)).toBeUndefined()
      expect(queryClient.getQueryState(keys.history)).toBeUndefined()
      for (const key of [keys.byObject, keys.mine]) {
        expect(isInvalidated(queryClient, key)).toBe(true)
      }
      for (const key of [keys.otherDetail, keys.otherHistory]) {
        expect(untouched(queryClient, key)).toBe(true)
      }
      expect(untouched(queryClient, keys.transitions)).toBe(true)
      expect(untouched(queryClient, keys.objectList)).toBe(true)
    })

    it('passes task_not_found through and keeps the cache as it was', async () => {
      const dbError = { code: 'P0001', message: 'task_not_found' }
      api.result = { data: null, error: dbError }
      const { result, queryClient } = setup(() => useDeleteTask())
      act(() => {
        result.current.mutate('t1')
      })
      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })
      expect(result.current.error).toBe(dbError)
      expect(queryClient.getQueryData(keys.detail)).toEqual({ seeded: true })
      expect(queryClient.getQueryData(keys.history)).toEqual({ seeded: true })
      for (const key of allKeys) expect(untouched(queryClient, key)).toBe(true)
    })

    it('passes the database error through and keeps the cache as it was', async () => {
      const dbError = { code: '42501', message: 'denied' }
      api.result = { data: null, error: dbError }
      const { result, queryClient } = setup(() => useDeleteTask())
      act(() => {
        result.current.mutate('t1')
      })
      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })
      expect(result.current.error).toBe(dbError)
      expect(queryClient.getQueryData(keys.detail)).toEqual({ seeded: true })
      for (const key of allKeys) expect(untouched(queryClient, key)).toBe(true)
    })
  })
})
