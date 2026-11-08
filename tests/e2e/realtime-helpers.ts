import type { Browser, Locator, Page } from '@playwright/test'

import { newUserPage } from './app-helpers'
import { expect, login, type E2EUser } from './fixtures'

export interface RealtimeWatch {
  /** Resolves when the realtime channels of `user` are joined and the toast cursor has been read. */
  ready: (user: Pick<E2EUser, 'id' | 'role'>) => Promise<void>
  /** Forgets everything seen so far (use before signing in as another user in the same page). */
  reset: () => void
}

/**
 * Observes the browser's realtime socket and the toast cursor read. A change made before both are
 * done is not announced by a toast (the cursor starts at the newest notification known at subscribe
 * time), so the tests wait for this instead of sleeping. Call it BEFORE the page signs in.
 */
export function watchRealtime(page: Page): RealtimeWatch {
  const joined = new Set<string>()
  let cursorReads = 0
  page.on('websocket', (ws) => {
    ws.on('framereceived', ({ payload }) => {
      const text = typeof payload === 'string' ? payload : payload.toString()
      if (!text.includes('phx_reply') || !text.includes('"status":"ok"')) return
      const topic = /realtime:((?:user|role):[\w-]+)/.exec(text)?.[1]
      if (topic) joined.add(topic)
    })
  })
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (
      response.request().method() === 'GET' &&
      url.pathname.endsWith('/rest/v1/notifications') &&
      url.searchParams.get('limit') === '1' &&
      url.searchParams.get('order') === 'created_at.desc'
    ) {
      cursorReads += 1
    }
  })
  return {
    ready: async (user) => {
      const topics = [`user:${user.id}`, ...(user.role === 'manager' ? ['role:manager'] : [])]
      await expect
        .poll(() => cursorReads > 0 && topics.every((topic) => joined.has(topic)), {
          message: 'realtime channels joined and toast cursor read',
          timeout: 20_000,
        })
        .toBe(true)
    },
    reset: () => {
      joined.clear()
      cursorReads = 0
    },
  }
}

export interface LiveSession {
  page: Page
  rt: RealtimeWatch
  /** Full page load of `path`, then waits until the new subscription and toast cursor are ready. */
  open: (path: string) => Promise<void>
}

/** A fresh browser context signed in as `user`, subscribed and ready to receive toasts. */
export async function liveSession(browser: Browser, user: E2EUser): Promise<LiveSession> {
  const page = await newUserPage(browser, { live: true })
  const rt = watchRealtime(page)
  await login(page, user)
  await rt.ready(user)
  const open = async (path: string) => {
    rt.reset()
    await page.goto(path)
    await rt.ready(user)
  }
  return { page, rt, open }
}

export const bell = (page: Page): Locator => page.getByRole('button', { name: /^Уведомления/ })

/** Unread counter read from the bell's accessible name (no badge = 0). */
export async function unreadCount(page: Page): Promise<number> {
  const name = (await bell(page).getAttribute('aria-label')) ?? ''
  const match = /непрочитанных: (\d+)/.exec(name)
  return match?.[1] ? Number(match[1]) : 0
}

export const bellPopover = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'Уведомления', exact: true })

/** Notification entry in the popover (a button whose name contains the task title). */
export const popoverItem = (page: Page, title: string, what?: string): Locator =>
  bellPopover(page).getByRole('button', {
    name: new RegExp(escapeRegExp(title) + (what ? '.*' + escapeRegExp(what) : '')),
  })

/** Toasts currently on screen (sonner list items inside its live region). */
export const toasts = (page: Page): Locator =>
  page.getByRole('region', { name: /alt\+T/ }).getByRole('listitem')

export const toastWith = (page: Page, text: string): Locator =>
  toasts(page).filter({ hasText: text })

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function moveTask(
  actor: E2EUser,
  taskId: string,
  to: 'in_progress' | 'in_review' | 'accepted' | 'rework',
  comment?: string,
): Promise<void> {
  const { error } = await actor.client.rpc('change_task_status', {
    p_task_id: taskId,
    p_to_status: to,
    ...(comment ? { p_comment: comment } : {}),
  })
  if (error) throw error
}

export async function reassignTask(actor: E2EUser, taskId: string, to: E2EUser): Promise<void> {
  const { error } = await actor.client.from('tasks').update({ assignee_id: to.id }).eq('id', taskId)
  if (error) throw error
}
