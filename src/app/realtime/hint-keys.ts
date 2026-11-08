import type { QueryKey } from '@tanstack/react-query'

import { notificationKeys } from '@/entities/notification'
import { objectKeys } from '@/entities/object'
import { taskKeys } from '@/entities/task'
import type { RealtimeHint } from '@/shared/api'

/**
 * Query keys that a hint makes stale. The hint only says «something changed here»:
 * the data is re-read by ordinary queries under RLS, never taken from the message.
 * Task lists are invalidated wholesale: an executor's object list depends on their tasks,
 * and a reassigned or deleted task leaves some lists entirely.
 */
export function keysForHint(hint: RealtimeHint): QueryKey[] {
  switch (hint.kind) {
    case 'task':
      return [
        taskKeys.detail(hint.id),
        taskKeys.history(hint.id),
        taskKeys.lists(),
        objectKeys.detail(hint.objectId),
        objectKeys.lists(),
      ]
    case 'object':
      return [objectKeys.detail(hint.id), objectKeys.lists(), taskKeys.lists()]
    case 'notification':
      return [notificationKeys.all]
  }
}
