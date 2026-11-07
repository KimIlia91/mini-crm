/// <reference lib="dom" />
import type { Locator, Page } from '@playwright/test'

import { mainNav } from './app-helpers'
import { createObject, createTask, createUser, expect, login, test, type E2EUser } from './fixtures'

// Returning to a list (breadcrumb / sidebar link) must restore search, filter and page at once:
// the link already carries the saved parameters and no frame shows an empty or jumping list.

test.skip(({ isMobile }) => isMobile, 'frame measurement is done on desktop 1280x800')
test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' })

const WINDOW_MS = 1_500
const uid = () => crypto.randomUUID().slice(0, 8)

interface ListFrame {
  path: string
  search: string
  input: string | null
  reset: boolean
  filter: string | null
  /** Table top without the entering page's own transform (layout position, not the animation). */
  tableY: number
  /** Accessible name of the table, to tell the entering list from a leaving page. */
  tableName: string | null
  pageText: string
}
interface ListWindow {
  __listRec?: { frames: ListFrame[]; stopAt: number; done: boolean }
}

/** Records every animation frame from now until WINDOW_MS after `action` returned. */
async function recordList(page: Page, action: () => Promise<void>): Promise<ListFrame[]> {
  await page.evaluate(() => {
    const w = window as unknown as ListWindow
    const rec = { frames: [] as ListFrame[], stopAt: performance.now() + 60_000, done: false }
    w.__listRec = rec
    const tick = () => {
      const main = document.querySelector('main')
      const buttons = Array.from(main?.querySelectorAll('button') ?? [])
      const input = main?.querySelector<HTMLInputElement>('input[type="search"]') ?? null
      const table = main?.querySelector('table') ?? null
      rec.frames.push({
        path: location.pathname,
        search: location.search,
        input: input ? input.value : null,
        reset: buttons.some((b) => b.innerText.includes('Сбросить')),
        // The name may come from aria-label or from (sr-only) content: use the text content.
        filter:
          buttons
            .map((b) => (b.getAttribute('aria-label') ?? b.textContent).trim())
            .find((label) => label.startsWith('Статус')) ?? null,
        tableY: table
          ? Math.round(
              table.getBoundingClientRect().y -
                new DOMMatrixReadOnly(
                  getComputedStyle(table.closest('[data-slot="page-transition"]') ?? table)
                    .transform,
                ).m42,
            )
          : -1,
        tableName: table
          ? (table.getAttribute('aria-label') ?? table.caption?.textContent ?? null)
          : null,
        pageText:
          Array.from(main?.querySelectorAll('[role="status"]') ?? [])
            .map((el) => el.textContent)
            .find((text) => text.includes('Страница')) ?? '',
      })
      if (performance.now() < rec.stopAt) requestAnimationFrame(tick)
      else rec.done = true
    }
    requestAnimationFrame(tick)
  })
  await action()
  await page.evaluate((ms) => {
    const rec = (window as unknown as ListWindow).__listRec
    if (rec) rec.stopAt = performance.now() + ms
  }, WINDOW_MS)
  await page.waitForFunction(() => (window as unknown as ListWindow).__listRec?.done === true)
  return page.evaluate(() => (window as unknown as ListWindow).__listRec?.frames ?? [])
}

interface Saved {
  q?: string
  status?: string
  page?: string
}

/** (a) The link back already carries the saved parameters in its href. */
async function expectHrefCarries(link: Locator, saved: Saved, label: string): Promise<void> {
  const href = await link.getAttribute('href')
  expect(href, `${label}: link has an href`).not.toBeNull()
  const params = new URL(href ?? '', 'http://localhost').searchParams
  for (const [key, value] of Object.entries(saved)) {
    expect(params.get(key), `${label}: href «${href ?? ''}» must carry ${key}`).toBe(value)
  }
}

/** (b) and (c): every frame on the list shows the saved state; the table does not jump; same page at the end. */
function expectNoJump(
  label: string,
  frames: ListFrame[],
  listPath: string,
  tableName: string,
  saved: Saved,
): void {
  // The URL changes first and the old page fades out for ~250 ms: only frames of the entering list
  // (its table is mounted) are judged; once it is mounted it must stay mounted.
  const onPath = frames.filter((f) => f.path === listPath)
  const firstEntering = onPath.findIndex((f) => f.tableName === tableName)
  expect(firstEntering, `${label}: the list was shown`).toBeGreaterThanOrEqual(0)
  const onList = onPath.slice(firstEntering)
  const finalFrame = onList.at(-1)
  const problems: string[] = []
  for (const f of onList) {
    const at = `t#${String(frames.indexOf(f))}`
    if (f.tableName !== tableName) problems.push(`${at} the list disappeared after it appeared`)
    if (saved.q !== undefined && f.input !== saved.q) {
      problems.push(
        `${at} search field is ${JSON.stringify(f.input)}, expected ${JSON.stringify(saved.q)}`,
      )
    }
    if (saved.status !== undefined && !/\d/.test(f.filter ?? '')) {
      problems.push(`${at} status filter shows no selection (${JSON.stringify(f.filter)})`)
    }
    if (!f.reset) problems.push(`${at} «Сбросить» is not visible`)
    if (f.tableY < 0) problems.push(`${at} table is missing`)
    else if (finalFrame && Math.abs(f.tableY - finalFrame.tableY) > 1) {
      problems.push(`${at} table y=${String(f.tableY)}, final y=${String(finalFrame.tableY)}`)
    }
    if (saved.page !== undefined && !f.pageText.includes(`Страница ${saved.page} из`)) {
      problems.push(`${at} page indicator «${f.pageText}», expected page ${saved.page}`)
    }
  }
  const unique = [...new Set(problems)]
  expect(
    unique.slice(0, 10),
    `${label}: ${String(problems.length)} of ${String(onList.length)} frames on ${listPath} violate the saved state (first shown); last frame ${JSON.stringify(finalFrame)}`,
  ).toEqual([])
  const finalParams = new URLSearchParams(finalFrame?.search ?? '')
  for (const [key, value] of Object.entries(saved)) {
    expect(
      finalParams.get(key),
      `${label}: final URL ${finalFrame?.search ?? ''} keeps ${key}`,
    ).toBe(value)
  }
}

/** After returning, the opened entity's row link is focused and inside the viewport. */
async function expectOpenedRowReady(table: Locator, name: string, label: string): Promise<void> {
  const link = table.getByRole('link', { name, exact: true })
  await expect(link, `${label}: opened row is shown`).toBeVisible()
  await expect(link, `${label}: opened row link is focused`).toBeFocused()
  await expect(link, `${label}: opened row is inside the viewport`).toBeInViewport()
}

/** Names of all row links currently shown in the table. */
async function rowNames(table: Locator): Promise<string[]> {
  return (await table.getByRole('link').allInnerTexts()).map((text) => text.trim())
}

/**
 * Name of the first row once the table shows a later page. The page indicator updates before the
 * rows (the previous page's rows stay as placeholder data), so wait until the first row is none of
 * the rows seen on the previous page.
 */
async function firstRowAfterPageChange(table: Locator, previous: string[]): Promise<string> {
  const first = table.getByRole('link').first()
  await expect
    .poll(async () => previous.includes((await first.innerText()).trim()), {
      message: 'the table shows rows of the new page',
    })
    .toBe(false)
  return (await first.innerText()).trim()
}

async function removeObject(m: E2EUser, id: string): Promise<void> {
  const { error } = await m.client.rpc('delete_object', { p_object_id: id })
  if (error) throw error
}

async function removeTask(m: E2EUser, id: string): Promise<void> {
  const { error } = await m.client.rpc('delete_task', { p_task_id: id })
  if (error) throw error
}

test.describe('return to a list without a jump', () => {
  test('manager: objects list (search + page 2) -> object -> crumb «Объекты»', async ({ page }) => {
    const m = await createUser('manager', 'back')
    const token = uid()
    const query = `Возврат ${token}`
    const ids: string[] = []
    try {
      for (let i = 1; i <= 13; i++) {
        ids.push(await createObject(m, `${query} ${String(i).padStart(2, '0')}`, 'Адрес'))
      }
      await login(page, m)
      await page.goto('/objects')
      await page.getByRole('searchbox', { name: 'Поиск по названию и адресу' }).fill(query)
      await expect(page.getByRole('status').filter({ hasText: 'Страница 1 из 2' })).toBeVisible()
      const objectsTable = page.getByRole('table', { name: 'Список объектов' })
      const firstPage = await rowNames(objectsTable)
      await page.getByRole('button', { name: 'Следующая страница' }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Страница 2 из 2' })).toBeVisible()
      const openedName = await firstRowAfterPageChange(objectsTable, firstPage)
      await objectsTable.getByRole('link').first().click()
      await expect(page).toHaveURL(/\/objects\/[0-9a-f-]{36}$/)
      const crumb = page
        .getByRole('navigation', { name: 'Навигация по страницам' })
        .getByRole('link', { name: 'Объекты', exact: true })
      await expect(crumb).toBeVisible()
      await expectHrefCarries(crumb, { q: query, page: '2' }, 'object page crumb')

      const frames = await recordList(page, () => crumb.click())
      expectNoJump('objects crumb', frames, '/objects', 'Список объектов', { q: query, page: '2' })
      await expectOpenedRowReady(objectsTable, openedName, 'objects crumb')
    } finally {
      for (const id of ids) await removeObject(m, id)
    }
  })

  test('manager: object tasks (status filter) -> task -> crumb of the object', async ({ page }) => {
    const [m, a] = await Promise.all([createUser('manager', 'back'), createUser('executor', 'a')])
    const token = uid()
    const objectName = `Фильтр ${token}`
    const objectId = await createObject(m, objectName, 'Адрес')
    const taskIds: string[] = []
    try {
      const working = await createTask(m, objectId, a, `В работе ${token}`)
      taskIds.push(working, await createTask(m, objectId, a, `Новая ${token}`))
      const { error } = await a.client.rpc('change_task_status', {
        p_task_id: working,
        p_to_status: 'in_progress',
      })
      if (error) throw error

      await login(page, m)
      await page.goto(`/objects/${objectId}`)
      await page.getByRole('button', { name: /^Статус/ }).click()
      await page.getByRole('menuitemcheckbox', { name: /В работе/ }).click()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('button', { name: 'Статус: выбрано 1' })).toBeVisible()
      await page.getByRole('link', { name: `В работе ${token}`, exact: true }).click()
      await expect(page.getByRole('heading', { level: 1, name: `В работе ${token}` })).toBeVisible()

      const crumb = page
        .getByRole('navigation', { name: 'Навигация по страницам' })
        .getByRole('link', { name: objectName, exact: true })
      await expect(crumb).toBeVisible()
      await expectHrefCarries(crumb, { status: 'in_progress' }, 'task page object crumb')

      const frames = await recordList(page, () => crumb.click())
      expectNoJump('object crumb', frames, `/objects/${objectId}`, 'Задачи объекта', {
        status: 'in_progress',
      })
      await expectOpenedRowReady(
        page.getByRole('table', { name: 'Задачи объекта' }),
        `В работе ${token}`,
        'object crumb',
      )
    } finally {
      for (const id of taskIds) {
        await removeTask(m, id)
      }
      await removeObject(m, objectId)
    }
  })

  test('executor: «Мои задачи» (search + page 2) -> task -> sidebar «Мои задачи»', async ({
    page,
  }) => {
    const [m, a] = await Promise.all([createUser('manager', 'back'), createUser('executor', 'a')])
    const token = uid()
    const query = `Возврат ${token}`
    const objectId = await createObject(m, `Объект ${token}`, 'Адрес')
    const taskIds: string[] = []
    try {
      for (let i = 1; i <= 12; i++) {
        taskIds.push(await createTask(m, objectId, a, `${query} ${String(i).padStart(2, '0')}`))
      }
      await login(page, a)
      // After sign-in the app loads the profile and only then redirects "/" to the role's home; with
      // parallel workers that answer can take longer than the default 5 s expect budget.
      await expect(page).toHaveURL(/\/my-tasks/, { timeout: 15_000 })
      await page.getByRole('searchbox', { name: 'Поиск по названию и объекту' }).fill(query)
      await expect(page.getByRole('status').filter({ hasText: 'Страница 1 из 2' })).toBeVisible()
      const myTable = page.getByRole('table', { name: 'Мои задачи' })
      const firstPage = await rowNames(myTable)
      await page.getByRole('button', { name: 'Следующая страница' }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Страница 2 из 2' })).toBeVisible()
      const openedName = await firstRowAfterPageChange(myTable, firstPage)
      await myTable.getByRole('link').first().click()
      await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/)

      const link = mainNav(page).getByRole('link', { name: 'Мои задачи', exact: true })
      await expectHrefCarries(link, { q: query, page: '2' }, 'sidebar «Мои задачи»')

      const frames = await recordList(page, () => link.click())
      expectNoJump('my tasks sidebar', frames, '/my-tasks', 'Мои задачи', { q: query, page: '2' })
      await expectOpenedRowReady(myTable, openedName, 'my tasks sidebar')
    } finally {
      for (const id of taskIds) {
        await removeTask(m, id)
      }
      await removeObject(m, objectId)
    }
  })

  test('manager: a page beyond the range falls back to the last page', async ({ page }) => {
    const m = await createUser('manager', 'back')
    const query = `Диапазон ${uid()}`
    const ids = await Promise.all(
      Array.from({ length: 13 }, (_, i) =>
        createObject(m, `${query} ${String(i + 1).padStart(2, '0')}`, 'Адрес'),
      ),
    )
    try {
      await login(page, m)
      await page.goto(`/objects?q=${encodeURIComponent(query)}&page=99`)
      await expect(page.getByRole('status').filter({ hasText: 'Страница 2 из 2' })).toBeVisible()
    } finally {
      for (const id of ids) await removeObject(m, id)
    }
  })

  test('manager: page 3 -> object -> sidebar «Объекты» opens page 3 again', async ({ page }) => {
    const m = await createUser('manager', 'back')
    const query = `Третья ${uid()}`
    const ids = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        createObject(m, `${query} ${String(i + 1).padStart(2, '0')}`, 'Адрес'),
      ),
    )
    try {
      await login(page, m)
      await page.goto('/objects')
      await page.getByRole('searchbox', { name: 'Поиск по названию и адресу' }).fill(query)
      await expect(page.getByRole('status').filter({ hasText: 'Страница 1 из 3' })).toBeVisible()
      const table = page.getByRole('table', { name: 'Список объектов' })
      const pageOne = await rowNames(table)
      await page.getByRole('button', { name: 'Следующая страница' }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Страница 2 из 3' })).toBeVisible()
      await firstRowAfterPageChange(table, pageOne)
      const pageTwo = await rowNames(table)
      await page.getByRole('button', { name: 'Следующая страница' }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Страница 3 из 3' })).toBeVisible()
      // On the list itself the sidebar link follows the live URL at once (the remembered copy is
      // written after render and used to lag one change behind).
      await expectHrefCarries(
        mainNav(page).getByRole('link', { name: 'Объекты', exact: true }),
        { q: query, page: '3' },
        'sidebar «Объекты» on the list',
      )
      const openedName = await firstRowAfterPageChange(table, [...pageOne, ...pageTwo])
      await table.getByRole('link').first().click()
      await expect(page).toHaveURL(/\/objects\/[0-9a-f-]{36}$/)

      const link = mainNav(page).getByRole('link', { name: 'Объекты', exact: true })
      await expectHrefCarries(link, { q: query, page: '3' }, 'sidebar «Объекты»')
      await link.click()
      await expect(page.getByRole('status').filter({ hasText: 'Страница 3 из 3' })).toBeVisible()
      await expectOpenedRowReady(table, openedName, 'objects sidebar')
    } finally {
      for (const id of ids) await removeObject(m, id)
    }
  })
})
