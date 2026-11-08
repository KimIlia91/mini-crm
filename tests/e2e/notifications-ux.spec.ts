/// <reference lib="dom" />
import type { Page } from '@playwright/test'

import {
  createObject,
  createTask,
  createUser,
  expect,
  settleAnimations,
  test,
  type E2EUser,
} from './fixtures'
import { LONG } from './layout-helpers'
import { bell, bellPopover, liveSession, moveTask, toastWith } from './realtime-helpers'

// UX criteria of the notifications audit (toasts and the bell popover). Realtime is on for every
// test here; every test makes its own users and data.

test.use({ liveUpdates: true })

const uid = () => crypto.randomUUID().slice(0, 8)
const SHOWN = { timeout: 10_000 }
const NARROW = [
  { width: 320, height: 640 },
  { width: 375, height: 812 },
] as const

const longTitle = () => `${uid()}-${LONG.taskTitle}`.slice(0, 200)

/** Waits until the page clock advanced `ms` since `since` (no fixed sleep). */
async function pageTimeElapsed(page: Page, since: number, ms: number): Promise<void> {
  await page.waitForFunction(
    ([start, wait]) => performance.now() - (start ?? 0) >= (wait ?? 0),
    [since, ms],
    { polling: 100, timeout: ms + 5_000 },
  )
}

const now = (page: Page) => page.evaluate(() => performance.now())

interface World {
  m: E2EUser
  a: E2EUser
  objectId: string
}

async function world(): Promise<World> {
  const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
  const objectId = await createObject(m, `Объект ${uid()}`)
  return { m, a, objectId }
}

test.describe('toast content and size', () => {
  test('U-01: a rework toast has no manager comment and stays small at 320 px', async ({
    browser,
  }) => {
    const { m, a, objectId } = await world()
    const taskId = await createTask(m, objectId, a, longTitle())
    await moveTask(a, taskId, 'in_progress')
    await moveTask(a, taskId, 'in_review')
    const s = await liveSession(browser, a)
    await s.page.setViewportSize(NARROW[0])
    const comment = `Секретная правка ${uid()}`

    await moveTask(m, taskId, 'rework', comment)

    const toast = toastWith(s.page, 'Возвращена на доработку')
    await expect(toast).toBeVisible(SHOWN)
    // The enter transition moves the toast; sizes are read once it has settled.
    await settleAnimations(s.page)
    await expect(toast, 'the manager comment is not repeated in the toast').not.toContainText(
      comment,
    )
    const box = await toast.boundingBox()
    expect(box, 'toast rendered').not.toBeNull()
    expect(box?.height ?? 9999, 'toast height <= 25 % of the 640 px viewport').toBeLessThanOrEqual(
      160,
    )
    expect(box?.y ?? -1, 'toast top edge inside the viewport').toBeGreaterThanOrEqual(0)
    const close = await toast.getByRole('button', { name: 'Закрыть уведомление' }).boundingBox()
    expect(close, 'close button rendered').not.toBeNull()
    expect(close?.y ?? -1, 'close button top inside the viewport').toBeGreaterThanOrEqual(0)
    expect(
      (close?.y ?? 0) + (close?.height ?? 0),
      'close button bottom inside the viewport',
    ).toBeLessThanOrEqual(640)
  })

  for (const vp of [
    { width: 320, height: 640 },
    { width: 1280, height: 800 },
  ]) {
    test(`U-04: the close button box is inside the toast box at ${String(vp.width)} px`, async ({
      browser,
    }) => {
      const { m, a, objectId } = await world()
      const s = await liveSession(browser, a)
      await s.page.setViewportSize(vp)
      const title = `Свежая ${uid()}`
      await createTask(m, objectId, a, title)
      const toast = toastWith(s.page, title)
      await expect(toast).toBeVisible(SHOWN)
      // The enter transition moves the toast; boxes are compared once it has settled.
      await settleAnimations(s.page)
      const box = await toast.boundingBox()
      const close = await toast.getByRole('button', { name: 'Закрыть уведомление' }).boundingBox()
      expect(box && close, 'toast and close button rendered').toBeTruthy()
      if (box && close) {
        expect(close.x, 'close left edge in the toast').toBeGreaterThanOrEqual(box.x - 0.5)
        expect(close.y, 'close top edge in the toast').toBeGreaterThanOrEqual(box.y - 0.5)
        expect(close.x + close.width, 'close right edge in the toast').toBeLessThanOrEqual(
          box.x + box.width + 0.5,
        )
        expect(close.y + close.height, 'close bottom edge in the toast').toBeLessThanOrEqual(
          box.y + box.height + 0.5,
        )
      }
    })
  }
})

test.describe('toast lifetime and page stability', () => {
  test('U-02: a toast with «Открыть» is still on screen 6 s later without hover or focus', async ({
    browser,
  }) => {
    const { m, a, objectId } = await world()
    const s = await liveSession(browser, a)
    const title = `Свежая ${uid()}`
    await createTask(m, objectId, a, title)
    const toast = toastWith(s.page, title)
    await expect(toast).toBeVisible(SHOWN)
    await expect(toast.getByRole('button', { name: 'Открыть' })).toBeVisible()
    const shownAt = await now(s.page)
    await s.page.mouse.move(0, 0)
    await pageTimeElapsed(s.page, shownAt, 6_000)
    await expect(toast, 'toast with an action must not vanish before 6 s').toBeVisible({
      timeout: 500,
    })
  })

  for (const vp of NARROW) {
    test(`U-05: a toast adds at most 7rem of scroll room on a short page and gives it back at ${String(vp.width)} px`, async ({
      browser,
    }) => {
      const { m, a, objectId } = await world()
      const s = await liveSession(browser, a)
      await s.page.setViewportSize(vp)
      await s.open(`/my-tasks?q=${encodeURIComponent(`нет-${uid()}`)}`)
      await expect(s.page.getByText('Ничего не найдено')).toBeVisible()
      const height = () => s.page.evaluate(() => document.documentElement.scrollHeight)
      const before = await height()

      const title = `Свежая ${uid()}`
      await createTask(m, objectId, a, title)
      await expect(toastWith(s.page, title)).toBeVisible(SHOWN)
      const withToast = await height()
      expect(
        withToast,
        'scrollHeight grows by at most 112 px (7rem) while the toast is shown',
      ).toBeLessThanOrEqual(before + 112)
      expect(withToast, 'the toast does not shrink the document').toBeGreaterThanOrEqual(before)

      await toastWith(s.page, title).getByRole('button', { name: 'Закрыть уведомление' }).click()
      await expect(toastWith(s.page, title)).toHaveCount(0)
      await expect.poll(height, { message: 'scrollHeight after the toast is gone' }).toBe(before)
    })
  }

  test('U-15: a toast about the task that is open has no «Открыть»', async ({ browser }) => {
    const { m, a, objectId } = await world()
    const title = `Задача ${uid()}`
    const taskId = await createTask(m, objectId, a, title)
    await moveTask(a, taskId, 'in_progress')
    await moveTask(a, taskId, 'in_review')
    const s = await liveSession(browser, a)
    await s.open(`/tasks/${taskId}`)
    await expect(s.page.getByRole('heading', { level: 1, name: title })).toBeVisible()

    await moveTask(m, taskId, 'rework', `Правка ${uid()}`)

    const toast = toastWith(s.page, 'Возвращена на доработку')
    await expect(toast).toBeVisible(SHOWN)
    // Checked once while the toast is shown: a retrying `toHaveCount(0)` would also pass after the
    // toast closes by itself. The action is sonner's [data-action] button («Открыть задачу: …»).
    await expect(toast.locator('[data-title]')).toBeVisible()
    expect(
      await toast.locator('button[data-action]').count(),
      'no «Открыть» on the open task',
    ).toBe(0)
  })
})

test.describe('bell popover', () => {
  test('U-12: after «Показать ещё» by keyboard focus is not lost to the body', async ({
    browser,
  }) => {
    const { m, a, objectId } = await world()
    await Promise.all(
      Array.from({ length: 22 }, (_, i) =>
        createTask(m, objectId, a, `Задача ${uid()} №${String(i)}`),
      ),
    )
    const s = await liveSession(browser, a)
    await bell(s.page).focus()
    await s.page.keyboard.press('Enter')
    await expect(bellPopover(s.page)).toBeVisible()
    const items = bellPopover(s.page).getByRole('listitem')
    await expect(items).toHaveCount(20, SHOWN)
    await bellPopover(s.page).getByRole('button', { name: 'Показать ещё' }).focus()
    await s.page.keyboard.press('Enter')

    await expect.poll(() => items.count(), SHOWN).toBeGreaterThan(20)
    const active = await s.page.evaluate(() => document.activeElement?.tagName ?? 'none')
    expect(active, 'focus stays in the popover (new item or the button), not on <body>').not.toBe(
      'BODY',
    )
    expect(
      await bellPopover(s.page).evaluate((el) => el.contains(document.activeElement)),
      'active element is inside the popover',
    ).toBe(true)
  })

  test('U-08: «Прочитать все» is announced and focus is not left on a disabled button', async ({
    browser,
  }) => {
    const { m, a, objectId } = await world()
    await createTask(m, objectId, a, `Первая ${uid()}`)
    await createTask(m, objectId, a, `Вторая ${uid()}`)
    const s = await liveSession(browser, a)
    await bell(s.page).click()
    await expect(bellPopover(s.page)).toBeVisible()
    await bellPopover(s.page).getByRole('button', { name: 'Прочитать все' }).click()

    await expect(
      s.page.getByRole('status').filter({ hasText: 'Все уведомления прочитаны' }),
      'live region announces the result',
    ).toBeVisible()
    const state = await s.page.evaluate(() => {
      const el = document.activeElement
      return {
        tag: el?.tagName ?? 'none',
        disabled: el instanceof HTMLButtonElement && el.disabled,
      }
    })
    expect(state.disabled, `focus is on a disabled <${state.tag}>`).toBe(false)
  })
})
