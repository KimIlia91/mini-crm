import { useMutation, useQueryClient } from '@tanstack/react-query'

import { getSupabaseClient } from '@/shared/api'

import type { TaskStatus } from '../model/task-status'
import { taskKeys } from './task'

export interface ChangeTaskStatusInput {
  taskId: string
  toStatus: TaskStatus
  comment?: string
}

export function useChangeTaskStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ taskId, toStatus, comment }: ChangeTaskStatusInput) => {
      const { error } = await getSupabaseClient().rpc('change_task_status', {
        p_task_id: taskId,
        p_to_status: toStatus,
        p_comment: comment,
      })
      if (error) throw error
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: taskKeys.all }),
  })
}
