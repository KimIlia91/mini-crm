import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { objectKeys } from '@/entities/object'
import { taskKeys, transitionKeys } from '@/entities/task'

import { ObjectNotAvailableError } from '../model/object-error'
import { useCreateObject, useDeleteObject, useUpdateObject } from './object-mutations'

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
  builder.maybeSingle = () => Promise.resolve(api.result)
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
  sort: { id: 'name', desc: false },
} as const
const taskListParams = {
  pageIndex: 0,
  pageSize: 10,
  search: '',
  sort: { id: 'status', desc: false },
  statuses: [],
} as const

const keys = {
  objectList: objectKeys.list(listParams),
  objectDetail: objectKeys.detail('o1'),
  otherObjectDetail: objectKeys.detail('o2'),
  tasksByObject: taskKeys.byObject('o1', taskListParams),
  taskDetail: taskKeys.detail('t1'),
  transitions: transitionKeys.all,
}
const allKeys = Object.values(keys)

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

const values = { name: 'Склад', address: 'ул. Ленина, 1' }

describe('object mutations and the query cache', () => {
  beforeEach(() => {
    api.result = { data: null, error: null }
    api.calls = []
  })

  describe('useCreateObject', () => {
    it('inserts the values and invalidates the object lists, leaving details and tasks alone', async () => {
      const { result, queryClient } = setup(() => useCreateObject())
      act(() => {
        result.current.mutate(values)
      })
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })
      expect(api.calls).toEqual(['from(objects)', `insert(${JSON.stringify(values)})`])
      expect(isInvalidated(queryClient, keys.objectList)).toBe(true)
      expect(untouched(queryClient, keys.objectDetail)).toBe(true)
      expect(untouched(queryClient, keys.tasksByObject)).toBe(true)
      expect(untouched(queryClient, keys.transitions)).toBe(true)
    })

    it('passes the database error through and leaves the cache untouched', async () => {
      const dbError = { code: '42501', message: 'rls' }
      api.result = { error: dbError }
      const { result, queryClient } = setup(() => useCreateObject())
      act(() => {
        result.current.mutate(values)
      })
      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })
      expect(result.current.error).toBe(dbError)
      for (const key of allKeys) expect(untouched(queryClient, key)).toBe(true)
    })
  })

  describe('useUpdateObject', () => {
    it('invalidates object queries and the tasks prefix (tasks embed the object name)', async () => {
      api.result = { data: { id: 'o1' }, error: null }
      const { result, queryClient } = setup(() => useUpdateObject('o1'))
      act(() => {
        result.current.mutate(values)
      })
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })
      expect(api.calls).toContain('eq("id","o1")')
      for (const key of [
        keys.objectList,
        keys.objectDetail,
        keys.otherObjectDetail,
        keys.tasksByObject,
        keys.taskDetail,
      ]) {
        expect(isInvalidated(queryClient, key)).toBe(true)
      }
      expect(untouched(queryClient, keys.transitions)).toBe(true)
    })

    it('0 affected rows throws ObjectNotAvailableError and does not touch the cache', async () => {
      api.result = { data: null, error: null }
      const { result, queryClient } = setup(() => useUpdateObject('o1'))
      act(() => {
        result.current.mutate(values)
      })
      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })
      expect(result.current.error).toBeInstanceOf(ObjectNotAvailableError)
      for (const key of allKeys) expect(untouched(queryClient, key)).toBe(true)
    })

    it('passes the database error through and leaves the cache untouched', async () => {
      const dbError = { code: '23514', message: 'check' }
      api.result = { data: null, error: dbError }
      const { result, queryClient } = setup(() => useUpdateObject('o1'))
      act(() => {
        result.current.mutate(values)
      })
      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })
      expect(result.current.error).toBe(dbError)
      for (const key of allKeys) expect(untouched(queryClient, key)).toBe(true)
    })
  })

  describe('useDeleteObject', () => {
    it('removes the deleted detail query and invalidates the object lists', async () => {
      api.result = { data: null, error: null }
      const { result, queryClient } = setup(() => useDeleteObject())
      act(() => {
        result.current.mutate('o1')
      })
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })
      expect(api.calls).toContain('rpc(delete_object,{"p_object_id":"o1"})')
      expect(queryClient.getQueryState(keys.objectDetail)).toBeUndefined()
      expect(isInvalidated(queryClient, keys.objectList)).toBe(true)
      expect(untouched(queryClient, keys.otherObjectDetail)).toBe(true)
      expect(untouched(queryClient, keys.tasksByObject)).toBe(true)
    })

    it('passes object_not_found through and keeps the cache as it was', async () => {
      const dbError = { code: 'P0001', message: 'object_not_found' }
      api.result = { data: null, error: dbError }
      const { result, queryClient } = setup(() => useDeleteObject())
      act(() => {
        result.current.mutate('o1')
      })
      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })
      expect(result.current.error).toBe(dbError)
      expect(queryClient.getQueryData(keys.objectDetail)).toEqual({ seeded: true })
      for (const key of allKeys) expect(untouched(queryClient, key)).toBe(true)
    })

    it('passes object_has_tasks through and keeps the cache as it was', async () => {
      const dbError = { code: 'P0001', message: 'object_has_tasks' }
      api.result = { data: null, error: dbError }
      const { result, queryClient } = setup(() => useDeleteObject())
      act(() => {
        result.current.mutate('o1')
      })
      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })
      expect(result.current.error).toBe(dbError)
      expect(queryClient.getQueryData(keys.objectDetail)).toEqual({ seeded: true })
      for (const key of allKeys) expect(untouched(queryClient, key)).toBe(true)
    })
  })
})
