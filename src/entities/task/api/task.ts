import { keepPreviousData, queryOptions } from '@tanstack/react-query'

import {
  getSupabaseClient,
  ilikeContains,
  normalizeSearch,
  pageRange,
  quoteFilterValue,
  readPage,
  type PageResult,
} from '@/shared/api'

import {
  taskOrder,
  type MyTaskListParams,
  type MyTaskRow,
  type ObjectTaskListParams,
  type ObjectTaskRow,
} from '../model/task-list'
import type { TransitionRule } from '../model/transitions'

export const taskKeys = {
  all: ['tasks'] as const,
  lists: () => [...taskKeys.all, 'list'] as const,
  byObject: (objectId: string, params: ObjectTaskListParams) =>
    [...taskKeys.lists(), 'by-object', objectId, params] as const,
  mine: (userId: string, params: MyTaskListParams) =>
    [...taskKeys.lists(), 'mine', userId, params] as const,
  detail: (id: string) => [...taskKeys.all, 'detail', id] as const,
  history: (id: string) => [...taskKeys.all, 'history', id] as const,
}

export const transitionKeys = {
  all: ['task-transitions'] as const,
}

// The related name is searched through a second embed under an alias: its filter keeps matching rows
// non-null, and `or(title…, <alias>.not.is.null)` turns «title OR related name» into one condition.
// `!inner` drops tasks whose related row is invisible to the viewer, so which tasks are listed also
// depends on RLS of `profiles` (profiles_select) and `objects` (objects_select), not only on `tasks`.
const ASSIGNEE_SELECT =
  'id, title, status, created_at, assignee:profiles!tasks_assignee_id_fkey!inner(id, full_name), assignee_search:profiles!tasks_assignee_id_fkey()'
const OBJECT_SELECT =
  'id, title, status, created_at, object:objects!tasks_object_id_fkey!inner(id, name), object_search:objects!tasks_object_id_fkey()'

const OBJECT_TASK_COLUMNS = { assignee: 'assignee(full_name)' }
const MY_TASK_COLUMNS = { object: 'object(name)' }

export const taskQueries = {
  /** One page of an object's tasks; RLS limits an executor to their own tasks. */
  byObject: (objectId: string, params: ObjectTaskListParams) => {
    const p = { ...params, search: normalizeSearch(params.search) }
    return queryOptions({
      queryKey: taskKeys.byObject(objectId, p),
      placeholderData: keepPreviousData,
      queryFn: ({ signal }): Promise<PageResult<ObjectTaskRow>> => {
        const [from, to] = pageRange(p)
        const pattern = ilikeContains(p.search)
        const filtered = (head: boolean) => {
          let query = getSupabaseClient()
            .from('tasks')
            .select(ASSIGNEE_SELECT, { count: 'exact', head })
            .eq('object_id', objectId)
          if (p.statuses.length > 0) query = query.in('status', p.statuses)
          if (p.search !== '') {
            query = query
              .ilike('assignee_search.full_name', pattern)
              .or(`title.ilike.${quoteFilterValue(pattern)},assignee_search.not.is.null`)
          }
          return query
        }
        return readPage(
          () =>
            taskOrder(p.sort, OBJECT_TASK_COLUMNS)
              .reduce(
                (query, key) => query.order(key.column, { ascending: key.ascending }),
                filtered(false),
              )
              .range(from, to)
              .abortSignal(signal)
              .overrideTypes<ObjectTaskRow[], { merge: false }>(),
          () => filtered(true).abortSignal(signal),
        )
      },
    })
  },
  /** One page of the executor's own tasks. */
  mine: (userId: string, params: MyTaskListParams) => {
    const p = { ...params, search: normalizeSearch(params.search) }
    return queryOptions({
      queryKey: taskKeys.mine(userId, p),
      placeholderData: keepPreviousData,
      queryFn: ({ signal }): Promise<PageResult<MyTaskRow>> => {
        const [from, to] = pageRange(p)
        const pattern = ilikeContains(p.search)
        const filtered = (head: boolean) => {
          let query = getSupabaseClient()
            .from('tasks')
            .select(OBJECT_SELECT, { count: 'exact', head })
            .eq('assignee_id', userId)
          if (p.statuses.length > 0) query = query.in('status', p.statuses)
          if (p.search !== '') {
            query = query
              .ilike('object_search.name', pattern)
              .or(`title.ilike.${quoteFilterValue(pattern)},object_search.not.is.null`)
          }
          return query
        }
        return readPage(
          () =>
            taskOrder(p.sort, MY_TASK_COLUMNS)
              .reduce(
                (query, key) => query.order(key.column, { ascending: key.ascending }),
                filtered(false),
              )
              .range(from, to)
              .abortSignal(signal)
              .overrideTypes<MyTaskRow[], { merge: false }>(),
          () => filtered(true).abortSignal(signal),
        )
      },
    })
  },
  /** `null` data = not found or not visible to the user. */
  detail: (id: string) =>
    queryOptions({
      queryKey: taskKeys.detail(id),
      queryFn: async ({ signal }) => {
        const { data, error } = await getSupabaseClient()
          .from('tasks')
          .select(
            `id, title, description, status, created_at, assignee_id, object_id,
             object:objects(id, name),
             assignee:profiles!tasks_assignee_id_fkey(id, full_name, email),
             author:profiles!tasks_author_id_fkey(id, full_name, email)`,
          )
          .eq('id', id)
          .abortSignal(signal)
          .maybeSingle()
        if (error) throw error
        return data
      },
    }),
  history: (id: string) =>
    queryOptions({
      queryKey: taskKeys.history(id),
      queryFn: async ({ signal }) => {
        const { data, error } = await getSupabaseClient()
          .from('task_status_history')
          .select(
            `id, from_status, to_status, comment, changed_at,
             changed_by:profiles!task_status_history_changed_by_fkey(id, full_name)`,
          )
          .eq('task_id', id)
          .order('id', { ascending: true })
          .abortSignal(signal)
        if (error) throw error
        return data
      },
    }),
}

export const transitionQueries = {
  all: () =>
    queryOptions({
      queryKey: transitionKeys.all,
      staleTime: Infinity,
      queryFn: async ({ signal }): Promise<TransitionRule[]> => {
        const { data, error } = await getSupabaseClient()
          .from('task_transitions')
          .select('from_status, to_status, actor_role, comment_required')
          .order('from_status')
          .order('to_status')
          .abortSignal(signal)
        if (error) throw error
        return data
      },
    }),
}
