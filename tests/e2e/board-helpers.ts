/// <reference lib="dom" />
import type { Locator, Page } from '@playwright/test'

import { createObject, createTask, expect, type E2EUser } from './fixtures'
import { moveTask } from './realtime-helpers'

export type BoardStatus = 'new' | 'in_progress' | 'in_review' | 'rework' | 'accepted'

export const STATUS_LABEL: Record<BoardStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  in_review: 'На проверке',
  rework: 'На доработке',
  accepted: 'Принята',
}

export const TRANSITION_LABEL = {
  take: 'Взять в работу',
  submit: 'Отправить на проверку',
  accept: 'Принять',
  rework: 'Вернуть на доработку',
} as const

/** Board switches from columns to tabs below this width (sm breakpoint of the app). */
const COLUMNS_MIN_WIDTH = 640

export const uid = (): string => crypto.randomUUID().slice(0, 8)

export const usesTabs = (page: Page): boolean =>
  (page.viewportSize()?.width ?? 1280) < COLUMNS_MIN_WIDTH

export const boardHeading = (page: Page): Locator =>
  page.getByRole('heading', { level: 1, name: 'Доска задач', exact: true })

export const objectFilter = (page: Page): Locator => page.getByRole('combobox', { name: /Объект/ })

export const filterSearch = (page: Page): Locator =>
  page.getByRole('combobox', { name: 'Поиск по названию или адресу' })

export const filterPopover = (page: Page): Locator =>
  page.getByRole('dialog').filter({ has: filterSearch(page) })

/** Opens the filter, searches `name` (server-side) and toggles that option; the popover stays open. */
export async function toggleObject(page: Page, name: string): Promise<void> {
  if (!(await filterSearch(page).isVisible())) await objectFilter(page).click()
  await filterSearch(page).fill(name)
  const option = page.getByRole('option', { name })
  await expect(option).toHaveCount(1)
  await option.click()
}

export async function closeFilter(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(filterSearch(page)).toBeHidden()
}

export const columnRegion = (page: Page, status: BoardStatus): Locator =>
  page.getByRole('region', { name: new RegExp(`^${STATUS_LABEL[status]}`) })

export const statusTab = (page: Page, status: BoardStatus): Locator =>
  page.getByRole('tab', { name: new RegExp(`^${STATUS_LABEL[status]}`) })

/** The place where the cards of `status` are rendered: the column (lg+) or the active tab panel. */
export const lane = (page: Page, status: BoardStatus): Locator =>
  usesTabs(page) ? page.getByRole('tabpanel') : columnRegion(page, status)

export async function openLane(page: Page, status: BoardStatus): Promise<Locator> {
  if (usesTabs(page)) {
    const tab = statusTab(page, status)
    await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
  }
  return lane(page, status)
}

export const cardOf = (scope: Page | Locator, title: string): Locator => {
  const page = 'page' in scope && typeof scope.page === 'function' ? scope.page() : (scope as Page)
  return scope
    .getByRole('article')
    .filter({ has: page.getByRole('link', { name: title, exact: true }) })
}

/** The total in the column header, or null while the column is not loaded yet (no sleeps, no throw). */
export async function readColumnTotal(page: Page, status: BoardStatus): Promise<number | null> {
  const source = usesTabs(page)
    ? statusTab(page, status)
    : columnRegion(page, status).getByRole('heading', { level: 2 })
  const text = await source.innerText({ timeout: 1_000 }).catch(() => '')
  const match = /(\d+)\D*$/.exec(text)
  return match?.[1] ? Number(match[1]) : null
}

/** Waits until the total is shown, then returns it. */
export async function columnTotal(page: Page, status: BoardStatus): Promise<number> {
  const seen: { total: number | null } = { total: null }
  await expect
    .poll(
      async () => {
        seen.total = await readColumnTotal(page, status)
        return seen.total !== null
      },
      { message: `total of «${STATUS_LABEL[status]}» is shown` },
    )
    .toBe(true)
  if (seen.total === null) throw new Error('unreachable: total was polled')
  return seen.total
}

/** Native HTML5 drag needs several moves over the target for dragover to fire. */
export async function dragCard(page: Page, title: string, to: BoardStatus): Promise<void> {
  const source = cardOf(columnsOf(page), title)
  const target = columnRegion(page, to)
  await source.scrollIntoViewIfNeeded()
  await target.scrollIntoViewIfNeeded()
  await source.hover()
  await page.mouse.down()
  await target.hover({ position: { x: 40, y: 80 } })
  await target.hover({ position: { x: 60, y: 100 } })
  await page.mouse.up()
}

const columnsOf = (page: Page): Locator => page.getByRole('main')

/** Every POST to the status RPC made by the page from now on. */
export function watchStatusRpc(page: Page): string[] {
  const calls: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/rpc/change_task_status')) {
      calls.push(request.url())
    }
  })
  return calls
}

export async function advanceTask(
  taskId: string,
  to: BoardStatus,
  executor: E2EUser,
  manager: E2EUser,
): Promise<void> {
  if (to === 'new') return
  await moveTask(executor, taskId, 'in_progress')
  if (to === 'in_progress') return
  await moveTask(executor, taskId, 'in_review')
  if (to === 'in_review') return
  if (to === 'accepted') await moveTask(manager, taskId, 'accepted')
  else await moveTask(manager, taskId, 'rework', 'Нужны правки')
}

export interface BoardSeed {
  objectId: string
  objectName: string
  task: (key: string) => { id: string; title: string }
}

/** One object with one task per requested status key (`name: status`), titles unique per call. */
export async function seedBoard(
  manager: E2EUser,
  executor: E2EUser,
  statuses: Record<string, BoardStatus>,
  objectName = `Объект ${uid()}`,
): Promise<BoardSeed> {
  const objectId = await createObject(manager, objectName)
  const tasks = new Map<string, { id: string; title: string }>()
  for (const [key, status] of Object.entries(statuses)) {
    const title = `Задача ${key} ${uid()}`
    const id = await createTask(manager, objectId, executor, title)
    await advanceTask(id, status, executor, manager)
    tasks.set(key, { id, title })
  }
  const task = (key: string) => {
    const found = tasks.get(key)
    if (!found) throw new Error(`no seeded task «${key}»`)
    return found
  }
  return { objectId, objectName, task }
}

/** Presses Tab until `target` has focus; fails when it is not reachable. */
export async function tabTo(page: Page, target: Locator, maxTabs = 80): Promise<void> {
  await expect(target).toBeVisible()
  for (let presses = 0; presses < maxTabs; presses++) {
    await page.keyboard.press('Tab')
    const focused = await target
      .evaluate((el) => el === document.activeElement, undefined, { timeout: 1_000 })
      .catch(() => false)
    if (focused) return
  }
  throw new Error(
    `${target.toString()} is not reachable with Tab within ${String(maxTabs)} presses`,
  )
}

export const focusIsOnBody = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.activeElement === document.body || document.activeElement === null)
