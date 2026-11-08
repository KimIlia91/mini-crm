/// <reference lib="dom" />
import { headerStatus, rowWithLink, signOut } from './app-helpers'
import { createObject, createTask, createUser, expect, login, test } from './fixtures'
import {
  bell,
  bellPopover,
  liveSession,
  moveTask,
  popoverItem,
  reassignTask,
  toastWith,
  toasts,
  unreadCount,
  watchRealtime,
} from './realtime-helpers'

// Live updates and notifications. Every test makes its own users and data; the local database is
// shared with other specs, so assertions name this test's own titles and compare counters by
// direction, never by absolute value for managers (every manager is notified of every review).
// "Appears" waits up to 10 s; "does not appear" is judged after a positive sentinel arrived.

test.use({ liveUpdates: true })

const uid = () => crypto.randomUUID().slice(0, 8)
const APPEARS = { timeout: 10_000 }

interface RealtimeWindow {
  __liveMarker?: string
}

test.describe('live updates', () => {
  test('executor sends to review: the manager sees status, toast and bell change without reload', async ({
    browser,
  }) => {
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const objectName = `Объект ${uid()}`
    const title = `Задача ${uid()}`
    const objectId = await createObject(m, objectName)
    const taskId = await createTask(m, objectId, a, title)

    const { page, open } = await liveSession(browser, m)
    await open(`/objects/${objectId}`)
    await expect(page.getByRole('heading', { level: 1, name: objectName })).toBeVisible()
    await expect(rowWithLink(page, title)).toContainText('Новая')
    const marker = uid()
    await page.evaluate((value) => {
      ;(window as unknown as RealtimeWindow).__liveMarker = value
    }, marker)
    const before = await unreadCount(page)

    await moveTask(a, taskId, 'in_progress')
    await expect(rowWithLink(page, title)).toContainText('В работе', APPEARS)
    await moveTask(a, taskId, 'in_review')
    await expect(rowWithLink(page, title)).toContainText('На проверке', APPEARS)

    const toast = toastWith(page, title).filter({ hasText: 'Отправлена на проверку' })
    await expect(toast).toBeVisible(APPEARS)
    const openTask = toast.getByRole('button', { name: `Открыть задачу: ${title}` })
    await expect(openTask).toBeVisible()
    await expect.poll(() => unreadCount(page), APPEARS).toBeGreaterThan(before)

    expect(
      await page.evaluate(() => (window as unknown as RealtimeWindow).__liveMarker),
      'the document was not reloaded',
    ).toBe(marker)

    // Other managers' events keep restacking the toasts of this shared database, so the button may
    // never be 'stable' for a pointer click; the keyboard activates it just as well.
    await openTask.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`))
    await expect(headerStatus(page, 'На проверке')).toBeVisible()
  })

  test('two managers: when one accepts, the other sees the request resolved; the executor gets a toast', async ({
    browser,
  }) => {
    const [m1, m2, a] = await Promise.all([
      createUser('manager', 'm1'),
      createUser('manager', 'm2'),
      createUser('executor', 'a'),
    ])
    const title = `Задача ${uid()}`
    const objectId = await createObject(m1, `Объект ${uid()}`)
    const taskId = await createTask(m1, objectId, a, title)
    await moveTask(a, taskId, 'in_progress')
    await moveTask(a, taskId, 'in_review')

    const [s1, s2, sa] = [
      await liveSession(browser, m1),
      await liveSession(browser, m2),
      await liveSession(browser, a),
    ]
    await expect.poll(() => unreadCount(s2.page), APPEARS).toBeGreaterThan(0)
    await bell(s2.page).click()
    const request = popoverItem(s2.page, title, 'Отправлена на проверку')
    await expect(request).toBeVisible()
    await expect(request).toContainText('Не прочитано')
    await s2.page.keyboard.press('Escape')
    await expect(bellPopover(s2.page)).toBeHidden()

    await s1.page.goto(`/tasks/${taskId}`)
    await s1.page.getByRole('button', { name: 'Принять', exact: true }).click()
    await expect(headerStatus(s1.page, 'Принята')).toBeVisible()

    await bell(s2.page).click()
    const item = popoverItem(s2.page, title, 'Отправлена на проверку')
    await expect(item).toContainText(`Принята: ${m1.fullName}`, APPEARS)
    await expect(item).not.toContainText('Не прочитано')

    await expect(toastWith(sa.page, title).filter({ hasText: 'Принята' })).toBeVisible(APPEARS)
  })

  test('reassign: the previous executor loses the task and is told, the new one gets it and is told', async ({
    browser,
  }) => {
    const [m, a1, a2] = await Promise.all([
      createUser('manager', 'm'),
      createUser('executor', 'a1'),
      createUser('executor', 'a2'),
    ])
    const title = `Задача ${uid()}`
    const objectId = await createObject(m, `Объект ${uid()}`)
    const taskId = await createTask(m, objectId, a1, title)

    const s1 = await liveSession(browser, a1)
    const s2 = await liveSession(browser, a2)
    await expect(s1.page.getByRole('link', { name: title, exact: true })).toBeVisible()
    await expect(s2.page.getByRole('link', { name: title, exact: true })).toHaveCount(0)

    await reassignTask(m, taskId, a2)

    await expect(s1.page.getByRole('link', { name: title, exact: true })).toHaveCount(0, APPEARS)
    await expect(
      toastWith(s1.page, title).filter({ hasText: 'Передана другому исполнителю' }),
    ).toBeVisible(APPEARS)
    await expect(s2.page.getByRole('link', { name: title, exact: true })).toBeVisible(APPEARS)
    await expect(toastWith(s2.page, title).filter({ hasText: 'Назначена вам' })).toBeVisible(
      APPEARS,
    )
  })

  test('executor on the task page: the manager deletes the task, the page shows not-found without a crash', async ({
    browser,
  }) => {
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const title = `Задача ${uid()}`
    const objectId = await createObject(m, `Объект ${uid()}`)
    const taskId = await createTask(m, objectId, a, title)

    const { page, open } = await liveSession(browser, a)
    const crashes: string[] = []
    page.on('pageerror', (error) => crashes.push(error.message))
    await open(`/tasks/${taskId}`)
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()

    const { error } = await m.client.rpc('delete_task', { p_task_id: taskId })
    if (error) throw error

    await expect(
      page.getByRole('heading', { level: 1, name: 'Задача не найдена или недоступна' }),
    ).toBeVisible(APPEARS)
    await expect(toastWith(page, title).filter({ hasText: 'Удалена' })).toBeVisible(APPEARS)
    expect(crashes, 'no uncaught page errors').toEqual([])
  })

  test('pagination: a new object on another page changes only the totals, not the page shown', async ({
    browser,
  }) => {
    const [m1, m2] = await Promise.all([createUser('manager', 'm1'), createUser('manager', 'm2')])
    const token = uid()
    const names = Array.from(
      { length: 20 },
      (_, i) => `Стр ${token} ${String(i + 1).padStart(2, '0')}`,
    )
    const ids = await Promise.all(names.map((name) => createObject(m1, name)))

    const { page, open } = await liveSession(browser, m1)
    await open(`/objects?q=${token}`)
    await expect(page.getByRole('row')).toHaveCount(11)
    await expect(page.getByRole('status').filter({ hasText: 'Страница 1 из 2' })).toBeVisible()
    const rowsBefore = await page.getByRole('row').allInnerTexts()
    const urlBefore = page.url()

    // «zz» sorts after every numbered name: it lands on a page the manager is not looking at.
    ids.push(await createObject(m2, `Стр ${token} zz`))

    await expect(page.getByRole('status').filter({ hasText: 'Страница 1 из 3' })).toBeVisible(
      APPEARS,
    )
    expect(await page.getByRole('row').allInnerTexts(), 'page 1 rows are unchanged').toEqual(
      rowsBefore,
    )
    expect(page.url(), 'the address is unchanged').toBe(urlBefore)

    for (const id of ids) {
      const { error } = await m1.client.rpc('delete_object', { p_object_id: id })
      if (error) throw error
    }
  })

  test('reconnect: changes made while the browser was offline arrive after it is back', async ({
    browser,
  }) => {
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const objectName = `Объект ${uid()}`
    const title = `Задача ${uid()}`
    const objectId = await createObject(m, objectName)
    const taskId = await createTask(m, objectId, a, title)

    const { page, open } = await liveSession(browser, m)
    await open(`/objects/${objectId}`)
    await expect(rowWithLink(page, title)).toContainText('Новая')

    await page.context().setOffline(true)
    await moveTask(a, taskId, 'in_progress')
    await page.context().setOffline(false)

    await expect(rowWithLink(page, title)).toContainText('В работе', { timeout: 20_000 })
  })

  test('sign out and sign in as another user: no foreign toasts, the bell shows only own items', async ({
    page,
  }) => {
    const [m, u1, u2] = await Promise.all([
      createUser('manager', 'm'),
      createUser('executor', 'u1'),
      createUser('executor', 'u2'),
    ])
    const objectId = await createObject(m, `Объект ${uid()}`)
    const t1 = `Для первого ${uid()}`
    const t2 = `Для второго ${uid()}`
    await createTask(m, objectId, u1, t1)
    await createTask(m, objectId, u2, t2)

    const rt = watchRealtime(page)
    await login(page, u1)
    await rt.ready(u1)
    await bell(page).click()
    await expect(popoverItem(page, t1)).toBeVisible()
    await page.keyboard.press('Escape')
    await signOut(page)

    rt.reset()
    await login(page, u2)
    await rt.ready(u2)
    await bell(page).click()
    await expect(popoverItem(page, t2)).toBeVisible()
    await expect(popoverItem(page, t1)).toHaveCount(0)
    await page.keyboard.press('Escape')

    // Events for both users: u2's toast is the sentinel that delivery finished; u1's must not show.
    const t1b = `Новое первому ${uid()}`
    const t2b = `Новое второму ${uid()}`
    await createTask(m, objectId, u1, t1b)
    await createTask(m, objectId, u2, t2b)
    await expect(toastWith(page, t2b)).toBeVisible(APPEARS)
    await expect(toasts(page).filter({ hasText: t1b })).toHaveCount(0)
    await expect(toasts(page).filter({ hasText: t1 })).toHaveCount(0)
    await bell(page).click()
    await expect(popoverItem(page, t1b)).toHaveCount(0)
    await expect(popoverItem(page, t2b)).toBeVisible()
  })
})

test.describe('bell', () => {
  test('opening the list reads nothing; an item reads itself and opens the task; «Прочитать все» clears', async ({
    page,
  }) => {
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const objectId = await createObject(m, `Объект ${uid()}`)
    const t1 = `Первая ${uid()}`
    const t2 = `Вторая ${uid()}`
    const task1 = await createTask(m, objectId, a, t1)
    await createTask(m, objectId, a, t2)

    await login(page, a)
    await expect(bell(page)).toHaveAccessibleName('Уведомления, непрочитанных: 2')

    await bell(page).click()
    await expect(popoverItem(page, t1)).toBeVisible()
    await expect(popoverItem(page, t2)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(bellPopover(page)).toBeHidden()
    expect(await unreadCount(page), 'opening and closing does not read').toBe(2)

    await popoverItemOpen(page)
    await popoverItem(page, t1).click()
    await expect(page).toHaveURL(new RegExp(`/tasks/${task1}$`))
    await expect(bell(page)).toHaveAccessibleName('Уведомления, непрочитанных: 1')
    await expect(bellPopover(page)).toBeHidden()

    await bell(page).click()
    const readAll = bellPopover(page).getByRole('button', { name: 'Прочитать все' })
    await expect(readAll).toBeEnabled()
    await readAll.click()
    await expect(bell(page)).toHaveAccessibleName('Уведомления')
    await expect(readAll).toBeDisabled()
  })

  test('keyboard: Enter opens, Esc closes and returns focus to the bell', async ({
    page,
    isMobile,
  }) => {
    test.skip(
      isMobile,
      'keyboard-only flow; the touch project has no keyboard focus ring to assert',
    )
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const objectId = await createObject(m, `Объект ${uid()}`)
    await createTask(m, objectId, a, `Задача ${uid()}`)

    await login(page, a)
    await bell(page).focus()
    await page.keyboard.press('Enter')
    await expect(bellPopover(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(bellPopover(page)).toBeHidden()
    await expect(bell(page)).toBeFocused()

    await page.keyboard.press('Space')
    await expect(bellPopover(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(bell(page)).toBeFocused()
  })
})

async function popoverItemOpen(page: Parameters<typeof bell>[0]): Promise<void> {
  await bell(page).click()
  await expect(bellPopover(page)).toBeVisible()
}
