import { queryOptions } from '@tanstack/react-query'

import { getSupabaseClient } from '@/shared/api'

import type { Executor, Viewer } from '../model/viewer'

export const profileKeys = {
  all: ['profiles'] as const,
  byId: (id: string) => [...profileKeys.all, 'by-id', id] as const,
  executors: () => [...profileKeys.all, 'executors'] as const,
}

export const profileQueries = {
  /** `null` data = no profile row (user has no access). */
  byId: (id: string) =>
    queryOptions({
      queryKey: profileKeys.byId(id),
      queryFn: async ({ signal }): Promise<Viewer | null> => {
        const { data, error } = await getSupabaseClient()
          .from('profiles')
          .select('id, role, full_name, must_change_password')
          .eq('id', id)
          .abortSignal(signal)
          .maybeSingle()
        if (error) throw error
        if (!data) return null
        return {
          id: data.id,
          role: data.role,
          fullName: data.full_name,
          mustChangePassword: data.must_change_password,
        }
      },
    }),
  executors: () =>
    queryOptions({
      queryKey: profileKeys.executors(),
      queryFn: async ({ signal }): Promise<Executor[]> => {
        const { data, error } = await getSupabaseClient()
          .from('profiles')
          .select('id, full_name')
          .eq('role', 'executor')
          .order('full_name')
          .abortSignal(signal)
        if (error) throw error
        return data.map((row) => ({ id: row.id, fullName: row.full_name }))
      },
    }),
}
