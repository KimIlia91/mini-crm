import { useMutation, useQueryClient } from '@tanstack/react-query'

import { objectKeys } from '@/entities/object'
import { taskKeys } from '@/entities/task'
import { getSupabaseClient } from '@/shared/api'

import { ObjectNotAvailableError } from '../model/object-error'
import type { ObjectFormValues } from '../model/object-form-schema'

export function useCreateObject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: ObjectFormValues) => {
      const { error } = await getSupabaseClient().from('objects').insert(values)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: objectKeys.lists() }),
  })
}

export function useUpdateObject(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: ObjectFormValues) => {
      const { data, error } = await getSupabaseClient()
        .from('objects')
        .update(values)
        .eq('id', id)
        .select('id')
        .maybeSingle()
      if (error) throw error
      if (!data) throw new ObjectNotAvailableError()
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: objectKeys.all }),
        queryClient.invalidateQueries({
          queryKey: taskKeys.all,
        }),
      ])
    },
  })
}

export function useDeleteObject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      // Soft delete in the database; P0001 object_not_found / object_has_tasks come back as errors.
      const { error } = await getSupabaseClient().rpc('delete_object', { p_object_id: id })
      if (error) throw error
    },
    onSuccess: (_data, id) => {
      // Drop the deleted object first so its still-mounted page does not refetch into «not found».
      queryClient.removeQueries({ queryKey: objectKeys.detail(id) })
      return queryClient.invalidateQueries({ queryKey: objectKeys.lists() })
    },
  })
}
