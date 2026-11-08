import { useMutation, useQueryClient } from '@tanstack/react-query'

import { getSupabaseClient } from '@/shared/api'

import { notificationKeys } from './notification'

function useInvalidateNotifications() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: notificationKeys.all })
}

/** Marks the given notifications read (the database ignores ids that are not the viewer's). */
export function useMarkNotificationsRead() {
  const invalidate = useInvalidateNotifications()
  return useMutation({
    mutationFn: async (ids: readonly string[]) => {
      const { error } = await getSupabaseClient().rpc('mark_notifications_read', {
        p_ids: [...ids],
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useMarkAllNotificationsRead() {
  const invalidate = useInvalidateNotifications()
  return useMutation({
    mutationFn: async () => {
      const { error } = await getSupabaseClient().rpc('mark_all_notifications_read')
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}
