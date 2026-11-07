import { useMutation, useQueryClient } from '@tanstack/react-query'

import { getSupabaseClient } from '@/shared/api'
import { taskKeys } from '@/entities/task'

import type { TaskFormValues } from '../model/task-form-schema'

export function useCreateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ objectId, ...values }: TaskFormValues & { objectId: string }) => {
      const { data, error } = await getSupabaseClient()
        .from('tasks')
        .insert({
          object_id: objectId,
          title: values.title,
          description: values.description,
          assignee_id: values.assigneeId,
        })
        .select('id')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: taskKeys.lists() }),
  })
}

/** object_id is deliberately not updatable (no column grant); `.single()` fails with PGRST116 on 0 rows. */
export function useUpdateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...values }: TaskFormValues & { id: string }) => {
      const { data, error } = await getSupabaseClient()
        .from('tasks')
        .update({
          title: values.title,
          description: values.description,
          assignee_id: values.assigneeId,
        })
        .eq('id', id)
        .select('id')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: taskKeys.all }),
  })
}

export function useDeleteTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await getSupabaseClient().rpc('delete_task', { p_task_id: id })
      if (error) throw error
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: taskKeys.detail(id) })
      queryClient.removeQueries({ queryKey: taskKeys.history(id) })
      return queryClient.invalidateQueries({ queryKey: taskKeys.lists() })
    },
  })
}
