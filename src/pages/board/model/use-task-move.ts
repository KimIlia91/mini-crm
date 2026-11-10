import { useRef, useState } from 'react'

import type { AppRole } from '@/entities/profile'
import { useChangeTaskStatus, type TaskStatus, type TransitionRule } from '@/entities/task'

import { findTransition, type MoveTask } from './board'

interface MoveTarget {
  task: MoveTask
  to: TaskStatus
}

/** Where the move started: the element focus returns to when the dialog is cancelled. */
export interface MoveOrigin {
  element: HTMLElement | null
  taskId: string
  status: TaskStatus
}

export interface LastMoved {
  id: string
  title: string
  to: TaskStatus
}

interface UseTaskMoveOptions {
  rules: readonly TransitionRule[]
  viewer: { id: string; role: AppRole }
}

/**
 * The one path of every board move (buttons and drop): a rule that needs a comment opens the
 * comment dialog, any other is sent at once. There is no optimistic update: the card stays where it
 * is and the whole board is blocked until the mutation and the refetch after it finish.
 * The next action clears the previous failure; the database re-checks every transition. The busy
 * guard is released when the mutation promise settles (never through per-call callbacks, which a
 * reset would drop), and the comment dialog cannot be closed while a request is in flight.
 */
export function useTaskMove({ rules, viewer }: UseTaskMoveOptions) {
  const change = useChangeTaskStatus()
  const [target, setTarget] = useState<MoveTarget | null>(null)
  const [commentOpen, setCommentOpen] = useState(false)
  const [lastMoved, setLastMoved] = useState<LastMoved | null>(null)
  const busy = useRef(false)
  const origin = useRef<MoveOrigin | null>(null)

  async function send({ task, to }: MoveTarget, comment?: string) {
    if (busy.current) return
    busy.current = true
    try {
      await change.mutateAsync({ taskId: task.id, toStatus: to, comment })
      setCommentOpen(false)
      setLastMoved({ id: task.id, title: task.title, to })
    } catch {
      return
    } finally {
      busy.current = false
    }
  }

  function request(task: MoveTask, to: TaskStatus) {
    if (change.isPending || busy.current) return
    const rule = findTransition(rules, task, viewer, to)
    if (rule === undefined) return
    change.reset()
    setLastMoved(null)
    origin.current = {
      element: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      taskId: task.id,
      status: task.status,
    }
    const next = { task, to }
    setTarget(next)
    if (rule.comment_required) setCommentOpen(true)
    else void send(next)
  }

  function submitComment(comment: string) {
    if (target === null) return
    void send(target, comment)
  }

  function closeComment() {
    if (busy.current) return
    setCommentOpen(false)
    change.reset()
  }

  return {
    request,
    submitComment,
    closeComment,
    dismissError: change.reset,
    clearLastMoved: () => {
      setLastMoved(null)
    },
    isPending: change.isPending,
    pending: change.isPending && target !== null ? { id: target.task.id, to: target.to } : null,
    commentTarget: commentOpen ? target : null,
    commentTo: target?.to,
    commentError: change.error,
    bannerError:
      !commentOpen && change.isError && target !== null
        ? { title: target.task.title, error: change.error }
        : null,
    lastMoved,
    getOrigin: () => origin.current,
  }
}

export type TaskMove = ReturnType<typeof useTaskMove>
