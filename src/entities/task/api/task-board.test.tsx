import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { taskKeys, taskQueries } from './task'

const api = vi.hoisted(() => ({ from: vi.fn() }))

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, getSupabaseClient: () => ({ from: api.from }) }
})

const ctx = () => ({ signal: new AbortController().signal, meta: undefined })

describe('taskKeys.board', () => {
  it('lives under taskKeys.lists() and carries every parameter', () => {
    const params = { status: 'new', objectIds: ['o1'], limit: 20 } as const
    const key = taskKeys.board(params)
    expect(key.slice(0, taskKeys.lists().length)).toEqual([...taskKeys.lists()])
    expect(key).toContainEqual(params)
    expect(taskKeys.board({ ...params, limit: 40 })).not.toEqual(key)
    expect(taskKeys.board({ ...params, status: 'rework' })).not.toEqual(key)
    expect(taskKeys.board({ status: 'new', limit: 20 })).not.toEqual(key)
  })

  it('invalidating the task lists marks every board column stale', async () => {
    const queryClient = new QueryClient()
    const a = taskKeys.board({ status: 'new', limit: 20 })
    const b = taskKeys.board({ status: 'accepted', objectIds: ['o1'], limit: 40 })
    queryClient.setQueryData(a, { rows: [], total: 0 })
    queryClient.setQueryData(b, { rows: [], total: 0 })
    await queryClient.invalidateQueries({ queryKey: taskKeys.lists(), refetchType: 'none' })
    expect(queryClient.getQueryState(a)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(b)?.isInvalidated).toBe(true)
  })

  it('invalidating taskKeys.all (the mutation) marks the board stale', async () => {
    const queryClient = new QueryClient()
    const key = taskKeys.board({ status: 'new', limit: 20 })
    queryClient.setQueryData(key, { rows: [], total: 0 })
    await queryClient.invalidateQueries({ queryKey: taskKeys.all, refetchType: 'none' })
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
  })
})

describe('taskQueries.boardColumn', () => {
  beforeEach(() => {
    api.from.mockReset()
  })

  it('uses the board key', () => {
    const params = { status: 'in_review', limit: 20 } as const
    expect(taskQueries.boardColumn(params).queryKey).toEqual(taskKeys.board(params))
  })

  it.each([0, -1, 101, 1.5, Number.NaN])(
    'limit %s fails with RangeError before any request',
    async (limit) => {
      const run = taskQueries.boardColumn({ status: 'new', limit }).queryFn as (
        c: unknown,
      ) => Promise<unknown>
      await expect(Promise.resolve().then(() => run(ctx()))).rejects.toBeInstanceOf(RangeError)
      expect(api.from).not.toHaveBeenCalled()
    },
  )

  it.each([1, 20, 100])('limit %s passes validation and reaches the request', async (limit) => {
    api.from.mockImplementation(() => {
      throw new Error('reached')
    })
    const run = taskQueries.boardColumn({ status: 'new', limit }).queryFn as (
      c: unknown,
    ) => Promise<unknown>
    await expect(Promise.resolve().then(() => run(ctx()))).rejects.toThrow('reached')
    expect(api.from).toHaveBeenCalledWith('tasks')
  })
})

describe('taskQueries.boardColumn with several objects', () => {
  beforeEach(() => {
    api.from.mockReset()
  })

  const keyOf = (objectIds?: readonly string[]) =>
    taskQueries.boardColumn({ status: 'new', objectIds, limit: 20 }).queryKey

  it('builds the same key whatever the order of the ids', () => {
    expect(keyOf(['b', 'a', 'c'])).toEqual(keyOf(['a', 'b', 'c']))
    expect(keyOf(['a', 'b'])).not.toEqual(keyOf(['a', 'c']))
  })

  it('an empty list means all objects and shares the key of no filter', () => {
    expect(keyOf([])).toEqual(keyOf(undefined))
    expect(keyOf(['a'])).not.toEqual(keyOf([]))
  })

  it('does not mutate the ids it is given', () => {
    const ids = ['b', 'a']
    keyOf(ids)
    expect(ids).toEqual(['b', 'a'])
  })

  function recordingBuilder() {
    const calls: [string, unknown[]][] = []
    const builder: unknown = new Proxy(
      {},
      {
        get: (_target, name) => {
          if (name === 'then') {
            return (resolve: (value: unknown) => void) => {
              resolve({ data: [], count: 0, error: null })
            }
          }
          return (...args: unknown[]) => {
            calls.push([String(name), args])
            return builder
          }
        },
      },
    )
    api.from.mockReturnValue(builder)
    return calls
  }

  it('filters with in() on the sorted ids', async () => {
    const calls = recordingBuilder()
    const run = taskQueries.boardColumn({ status: 'new', objectIds: ['b', 'a'], limit: 20 })
      .queryFn as (c: unknown) => Promise<unknown>
    await run(ctx())
    expect(calls).toContainEqual(['in', ['object_id', ['a', 'b']]])
  })

  it.each([undefined, []])('does not filter by object for %j', async (objectIds) => {
    const calls = recordingBuilder()
    const run = taskQueries.boardColumn({ status: 'new', objectIds, limit: 20 }).queryFn as (
      c: unknown,
    ) => Promise<unknown>
    await run(ctx())
    expect(calls.map(([name]) => name)).not.toContain('in')
  })
})
