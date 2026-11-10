/// <reference lib="dom" />
import type { Page } from '@playwright/test'

import { mainNav, SIDEBAR_TOGGLE, usesSidebarSheet } from './app-helpers'
import {
  boardHeading,
  cardOf,
  columnRegion,
  columnTotal,
  readColumnTotal,
  dragCard,
  focusIsOnBody,
  lane,
  closeFilter,
  filterPopover,
  filterSearch,
  objectFilter,
  toggleObject,
  openLane,
  seedBoard,
  STATUS_LABEL,
  statusTab,
  tabTo,
  TRANSITION_LABEL,
  uid,
  usesTabs,
  watchStatusRpc,
} from './board-helpers'
import { createObject, createTask, createUser, expect, login, test } from './fixtures'
import { liveSession, moveTask, toastWith } from './realtime-helpers'

// Kanban board. Every test creates its own users and data; wording comes from the board and entity-task i18n.

const APPEARS = { timeout: 10_000 }
const NOT_FOUND_TEXT = 'Объект не найден или недоступен'

async function openBoardFromNav(page: Parameters<typeof mainNav>[0]): Promise<void> {
  if (usesSidebarSheet(page)) await page.getByRole('button', { name: SIDEBAR_TOGGLE }).click()
  await mainNav(page).getByRole('link', { name: 'Доска', exact: true }).click()
  await expect(page).toHaveURL(/\/board/)
  await expect(boardHeading(page)).toBeVisible()
}

test.describe('board: manager on desktop', () => {
  test.skip(
    ({ isMobile }) => isMobile,
    'drag and columns are desktop-only; mobile has its own block',
  )

  test('nav item, object filter in the URL, survives reload and history', async ({ page }) => {
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const one = await seedBoard(m, a, { one: 'new' })
    const two = await seedBoard(m, a, { two: 'new' })
    const t1 = one.task('one').title
    const t2 = two.task('two').title
    await login(page, m)

    await openBoardFromNav(page)
    await expect(mainNav(page).getByRole('link', { name: 'Доска', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(page.getByRole('link', { name: t1, exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: t2, exact: true })).toBeVisible()

    await toggleObject(page, one.objectName)
    await closeFilter(page)
    await expect(page).toHaveURL(new RegExp(`object=${one.objectId}`))
    await expect(page.getByRole('link', { name: t2, exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: t1, exact: true })).toBeVisible()

    await page.reload()
    await expect(page).toHaveURL(new RegExp(`object=${one.objectId}`))
    await expect(page.getByRole('link', { name: t1, exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: t2, exact: true })).toHaveCount(0)

    await toggleObject(page, two.objectName)
    await closeFilter(page)
    await expect(page).toHaveURL(new RegExp(`object=${two.objectId}`))
    await expect(page.getByRole('link', { name: t1, exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: t2, exact: true })).toBeVisible()

    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`object=${one.objectId}`))
    await expect(page).not.toHaveURL(new RegExp(`object=${two.objectId}`))
    await expect(page.getByRole('link', { name: t2, exact: true })).toHaveCount(0)
    await page.goForward()
    await expect(page).toHaveURL(new RegExp(`object=${two.objectId}`))
    await expect(page.getByRole('link', { name: t2, exact: true })).toBeVisible()
  })

  test('drag «На проверке» to «Принята»: totals and the task history change', async ({ page }) => {
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const seed = await seedBoard(m, a, { dragged: 'in_review', stay: 'in_review' })
    const { title, id } = seed.task('dragged')
    await login(page, m)
    await page.goto(`/board?object=${seed.objectId}`)
    await expect(cardOf(columnRegion(page, 'in_review'), title)).toBeVisible()
    expect(await columnTotal(page, 'in_review')).toBe(2)
    expect(await columnTotal(page, 'accepted')).toBe(0)

    await dragCard(page, title, 'accepted')

    await expect(cardOf(columnRegion(page, 'accepted'), title)).toBeVisible(APPEARS)
    await expect(cardOf(columnRegion(page, 'in_review'), title)).toHaveCount(0)
    await expect.poll(() => readColumnTotal(page, 'in_review')).toBe(1)
    await expect.poll(() => readColumnTotal(page, 'accepted')).toBe(1)
    await expect(toastWith(page, title)).toBeVisible()

    await page.goto(`/tasks/${id}`)
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
    await expect(page.getByRole('listitem').filter({ hasText: 'Принята' }).first()).toBeVisible()
    const { data } = await m.client.from('tasks').select('status').eq('id', id).single()
    expect(data?.status).toBe('accepted')
  })

  test('drag onto «На доработке»: comment dialog, empty submit is rejected, comment lands in history', async ({
    page,
  }) => {
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const seed = await seedBoard(m, a, { back: 'in_review' })
    const { title, id } = seed.task('back')
    const comment = `Нужны правки ${uid()}`
    await login(page, m)
    await page.goto(`/board?object=${seed.objectId}`)
    await expect(cardOf(columnRegion(page, 'in_review'), title)).toBeVisible()
    const rpc = watchStatusRpc(page)

    await dragCard(page, title, 'rework')
    const dialog = page.getByRole('dialog', { name: TRANSITION_LABEL.rework })
    await expect(dialog).toBeVisible()
    expect(rpc, 'nothing is sent before the comment is given').toHaveLength(0)

    await dialog.getByRole('button', { name: TRANSITION_LABEL.rework }).click()
    await expect(dialog.getByText('Укажите комментарий')).toBeVisible()
    await expect(dialog).toBeVisible()
    expect(rpc).toHaveLength(0)

    await dialog.getByLabel('Комментарий').fill(comment)
    await dialog.getByRole('button', { name: TRANSITION_LABEL.rework }).click()
    await expect(dialog).toBeHidden()
    await expect(cardOf(columnRegion(page, 'rework'), title)).toBeVisible(APPEARS)
    await expect(cardOf(columnRegion(page, 'in_review'), title)).toHaveCount(0)
    expect(rpc).toHaveLength(1)

    await page.goto(`/tasks/${id}`)
    await expect(page.getByRole('listitem').filter({ hasText: comment })).toBeVisible()
  })

  test('cancelling the comment dialog changes nothing', async ({ page }) => {
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const seed = await seedBoard(m, a, { keep: 'in_review' })
    const { title } = seed.task('keep')
    await login(page, m)
    await page.goto(`/board?object=${seed.objectId}`)
    const rpc = watchStatusRpc(page)

    await dragCard(page, title, 'rework')
    const dialog = page.getByRole('dialog', { name: TRANSITION_LABEL.rework })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(cardOf(columnRegion(page, 'in_review'), title)).toBeVisible()
    expect(rpc).toHaveLength(0)
    await expect.poll(() => focusIsOnBody(page)).toBe(false)
  })

  test('25 tasks in a column: «Показать ещё (5)» loads the rest and disappears', async ({
    page,
  }) => {
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const objectId = await createObject(m, `Объект ${uid()}`)
    const token = uid()
    const rows = Array.from({ length: 25 }, (_, i) => ({
      object_id: objectId,
      assignee_id: a.id,
      title: `Масса ${token} ${String(i + 1).padStart(2, '0')}`,
      description: '',
    }))
    const { error } = await m.client.from('tasks').insert(rows)
    if (error) throw error
    await login(page, m)
    await page.goto(`/board?object=${objectId}`)

    const column = columnRegion(page, 'new')
    await expect(column.getByRole('article')).toHaveCount(20)
    expect(await columnTotal(page, 'new')).toBe(25)
    const more = column.getByRole('button', { name: 'Показать ещё (5)' })
    await more.click()
    await expect(column.getByRole('article')).toHaveCount(25)
    await expect(column.getByRole('button', { name: /Показать ещё/ })).toHaveCount(0)
  })

  test('garbage ?object shows all tasks; foreign or deleted object shows not-found and resets', async ({
    page,
  }) => {
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const seed = await seedBoard(m, a, { x: 'new' })
    const { title } = seed.task('x')
    await login(page, m)

    await page.goto('/board?object=not-a-uuid')
    await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible()
    await expect(page).not.toHaveURL(/object=/)
    await expect(page.getByText(NOT_FOUND_TEXT)).toHaveCount(0)

    await page.goto(`/board?object=${crypto.randomUUID()}`)
    await expect(page.getByText(NOT_FOUND_TEXT)).toBeVisible()
    const reset = page
      .getByRole('button', { name: 'Показать все объекты' })
      .or(page.getByRole('link', { name: 'Показать все объекты' }))
    await reset.click()
    await expect(page).not.toHaveURL(/object=/)
    await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible()
    await expect(page.getByText(NOT_FOUND_TEXT)).toHaveCount(0)
  })
})

test.describe('board: executor on desktop', () => {
  test.skip(
    ({ isMobile }) => isMobile,
    'drag and columns are desktop-only; mobile has its own block',
  )

  test('drag onto a forbidden column sends nothing and changes nothing', async ({ page }) => {
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const seed = await seedBoard(m, a, { work: 'in_progress' })
    const { title, id } = seed.task('work')
    await login(page, a)
    await page.goto('/board')
    await expect(cardOf(columnRegion(page, 'in_progress'), title)).toBeVisible()
    const rpc = watchStatusRpc(page)

    await dragCard(page, title, 'accepted')

    await expect(cardOf(columnRegion(page, 'in_progress'), title)).toBeVisible()
    expect(rpc, 'no rpc for a forbidden drop').toHaveLength(0)
    await page.reload()
    await expect(cardOf(columnRegion(page, 'in_progress'), title)).toBeVisible()
    const { data } = await m.client.from('tasks').select('status').eq('id', id).single()
    expect(data?.status).toBe('in_progress')
  })

  test('keyboard: Tab to «Взять в работу», Enter moves the card, focus stays on its link, status is announced', async ({
    page,
  }) => {
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const seed = await seedBoard(m, a, { kb: 'new' })
    const { title } = seed.task('kb')
    await login(page, a)
    await page.goto('/board')
    await expect(boardHeading(page)).toBeVisible()
    const card = cardOf(columnRegion(page, 'new'), title)
    await expect(card).toBeVisible()

    await tabTo(page, card.getByRole('button', { name: TRANSITION_LABEL.take }))
    await page.keyboard.press('Enter')

    const moved = cardOf(columnRegion(page, 'in_progress'), title)
    await expect(moved).toBeVisible(APPEARS)
    await expect(cardOf(columnRegion(page, 'new'), title)).toHaveCount(0)
    await expect(moved.getByRole('link', { name: title, exact: true })).toBeFocused()
    expect(await focusIsOnBody(page)).toBe(false)
    await expect(toastWith(page, title)).toBeVisible()
  })

  test('double click on a move button sends exactly one request', async ({ page }) => {
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const seed = await seedBoard(m, a, { dbl: 'new' })
    const { title, id } = seed.task('dbl')
    await login(page, a)
    await page.goto('/board')
    const card = cardOf(columnRegion(page, 'new'), title)
    await expect(card).toBeVisible()
    const rpc = watchStatusRpc(page)

    await card.getByRole('button', { name: TRANSITION_LABEL.take }).dblclick()

    await expect(cardOf(columnRegion(page, 'in_progress'), title)).toBeVisible(APPEARS)
    await expect.poll(() => rpc.length).toBe(1)
    const { data } = await m.client
      .from('task_status_history')
      .select('id')
      .eq('task_id', id)
      .eq('to_status', 'in_progress')
    expect(data).toHaveLength(1)
  })

  test('cards of other executors in the same object are absent', async ({ page }) => {
    const [m, a, b] = await Promise.all([
      createUser('manager', 'm'),
      createUser('executor', 'a'),
      createUser('executor', 'b'),
    ])
    const objectId = await createObject(m, `Объект ${uid()}`)
    const mine = `Моя ${uid()}`
    const foreign = `Чужая ${uid()}`
    await createTask(m, objectId, a, mine)
    await createTask(m, objectId, b, foreign)
    await login(page, a)
    await page.goto(`/board?object=${objectId}`)
    await expect(page.getByRole('link', { name: mine, exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: foreign, exact: true })).toHaveCount(0)
    expect(await columnTotal(page, 'new'), 'the total does not count foreign tasks').toBe(1)
  })
})

test.describe('board: security (database stays the authority)', () => {
  test('a forbidden transition sent from the page is rejected by the database', async ({
    page,
    supabaseUrl,
    supabasePublishableKey,
  }) => {
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const seed = await seedBoard(m, a, { work: 'in_review' })
    const { id } = seed.task('work')
    await login(page, a)
    await page.goto('/board')
    await expect(boardHeading(page)).toBeVisible()

    const status = await page.evaluate(
      async ({ url, key, taskId }) => {
        const storageKey = Object.keys(localStorage).find((k) => /^sb-.+-auth-token$/.test(k))
        const raw = storageKey ? localStorage.getItem(storageKey) : null
        const token = raw ? (JSON.parse(raw) as { access_token: string }).access_token : ''
        const response = await fetch(`${url}/rest/v1/rpc/change_task_status`, {
          method: 'POST',
          headers: {
            apikey: key,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ p_task_id: taskId, p_to_status: 'accepted' }),
        })
        return response.status
      },
      { url: supabaseUrl, key: supabasePublishableKey, taskId: id },
    )
    expect(status, 'the rpc must be refused').toBeGreaterThanOrEqual(400)
    const { data } = await m.client.from('tasks').select('status').eq('id', id).single()
    expect(data?.status).toBe('in_review')
  })

  test('executor opening a foreign object id sees not-found, not the object', async ({ page }) => {
    const [m, a, b] = await Promise.all([
      createUser('manager', 'm'),
      createUser('executor', 'a'),
      createUser('executor', 'b'),
    ])
    const foreignObject = await createObject(m, `Объект ${uid()}`)
    await createTask(m, foreignObject, b, `Чужая ${uid()}`)
    await login(page, a)
    await page.goto(`/board?object=${foreignObject}`)
    await expect(page.getByText(NOT_FOUND_TEXT)).toBeVisible()
  })
})

test.describe('board: entry points', () => {
  test('executor reaches the board only through the sidebar item; there is no view switch', async ({
    page,
  }) => {
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const seed = await seedBoard(m, a, { mine: 'in_progress' })
    await login(page, a)
    await expect(page).toHaveURL(/\/my-tasks/)
    await expect(page.getByRole('navigation', { name: 'Вид задач' })).toHaveCount(0)
    await openBoardFromNav(page)
    await expect(page.getByRole('navigation', { name: 'Вид задач' })).toHaveCount(0)
    await expect(
      page.getByRole('link', { name: seed.task('mine').title, exact: true }),
    ).toBeVisible()
  })

  test('manager: the object page has no board link, /board?object= still works', async ({
    page,
  }) => {
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const seed = await seedBoard(m, a, { s: 'new' })
    await login(page, m)
    await page.goto(`/objects/${seed.objectId}`)
    await expect(page.getByRole('heading', { level: 1, name: seed.objectName })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Вид задач' })).toHaveCount(0)
    await expect(page.getByRole('main').getByRole('link', { name: 'Доска' })).toHaveCount(0)

    await page.goto(`/board?object=${seed.objectId}`)
    await expect(boardHeading(page)).toBeVisible()
    const laneNew = await openLane(page, 'new')
    await expect(cardOf(laneNew, seed.task('s').title)).toBeVisible()
  })
})

test.describe('board: stale data', () => {
  test('task deleted elsewhere: the move shows an alert and the card disappears after refetch', async ({
    page,
  }) => {
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const seed = await seedBoard(m, a, { gone: 'new', rest: 'new' })
    const { title, id } = seed.task('gone')
    await login(page, a)
    await page.goto('/board')
    const laneNew = await openLane(page, 'new')
    const card = cardOf(laneNew, title)
    await expect(card).toBeVisible()

    const { error } = await m.client.rpc('delete_task', { p_task_id: id })
    if (error) throw error

    await card.getByRole('button', { name: TRANSITION_LABEL.take }).click()
    await expect(page.getByRole('alert').first()).toBeVisible(APPEARS)
    await expect(cardOf(lane(page, 'new'), title)).toHaveCount(0, APPEARS)
  })
})

test.describe('board: live updates', () => {
  test.use({ liveUpdates: true })
  test.skip(
    ({ isMobile }) => isMobile,
    'same subscription on both layouts; checked once on desktop',
  )

  test('executor takes a task into work: the manager board moves the card without reload', async ({
    browser,
  }) => {
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const seed = await seedBoard(m, a, { live: 'new' })
    const { title, id } = seed.task('live')
    const { page, open } = await liveSession(browser, m)
    await open(`/board?object=${seed.objectId}`)
    await expect(cardOf(columnRegion(page, 'new'), title)).toBeVisible()
    const marker = uid()
    await page.evaluate((value) => {
      ;(window as unknown as { __boardMarker?: string }).__boardMarker = value
    }, marker)

    await moveTask(a, id, 'in_progress')

    await expect(cardOf(columnRegion(page, 'in_progress'), title)).toBeVisible(APPEARS)
    await expect(cardOf(columnRegion(page, 'new'), title)).toHaveCount(0)
    expect(
      await page.evaluate(() => (window as unknown as { __boardMarker?: string }).__boardMarker),
      'the document was not reloaded',
    ).toBe(marker)
  })
})

test.describe('board: mobile tabs', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch layout; the desktop project covers columns')

  for (const width of [320, 375]) {
    test(`${String(width)} px: one column with five 44 px tabs, no page scroll, no draggable cards`, async ({
      page,
    }) => {
      const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
      const seed = await seedBoard(m, a, { work: 'in_progress', wait: 'in_review' })
      await login(page, a)
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/board')
      await expect(boardHeading(page)).toBeVisible()
      expect(usesTabs(page)).toBe(true)

      for (const status of ['new', 'in_progress', 'in_review', 'rework', 'accepted'] as const) {
        const tab = statusTab(page, status)
        await expect(tab).toBeVisible()
        const box = await tab.boundingBox()
        expect(box?.height ?? 0, `${STATUS_LABEL[status]} tab height`).toBeGreaterThanOrEqual(43.5)
        expect(box?.x ?? -1).toBeGreaterThanOrEqual(0)
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width + 0.5)
      }
      await expect(page.getByRole('tabpanel')).toHaveCount(1)
      await expect(
        cardOf(page.getByRole('tabpanel'), seed.task('work').title),
        'default column for an executor is «В работе»',
      ).toBeVisible()
      await expect(
        page.getByRole('link', { name: seed.task('wait').title, exact: true }),
      ).toHaveCount(0)

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, 'no horizontal page scroll').toBeLessThanOrEqual(0)
      const draggable = await page.evaluate(
        () => document.querySelectorAll('[draggable="true"]').length,
      )
      expect(draggable, 'cards are not draggable on touch').toBe(0)
    })
  }

  test('moving by button: the card leaves the column, the result is announced, focus is not lost', async ({
    page,
  }) => {
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const seed = await seedBoard(m, a, { work: 'in_progress' })
    const { title } = seed.task('work')
    await login(page, a)
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/board')
    const panel = page.getByRole('tabpanel')
    const card = cardOf(panel, title)
    await expect(card).toBeVisible()
    const before = await columnTotal(page, 'in_review')

    await card.getByRole('button', { name: TRANSITION_LABEL.submit }).click()

    await expect(cardOf(page.getByRole('tabpanel'), title)).toHaveCount(0, APPEARS)
    await expect(toastWith(page, title)).toBeVisible()
    await expect.poll(() => readColumnTotal(page, 'in_review')).toBe(before + 1)
    expect(await focusIsOnBody(page)).toBe(false)
  })

  test('?column survives reload and return from the task; Back leaves the board', async ({
    page,
  }) => {
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const seed = await seedBoard(m, a, { wait: 'in_review' })
    const { title } = seed.task('wait')
    await login(page, a)
    await expect(page).toHaveURL(/\/my-tasks/)
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/board')
    await expect(boardHeading(page)).toBeVisible()

    await statusTab(page, 'in_review').click()
    await expect(page).toHaveURL(/column=in_review/)
    await page.reload()
    await expect(statusTab(page, 'in_review')).toHaveAttribute('aria-selected', 'true')
    await expect(cardOf(page.getByRole('tabpanel'), title)).toBeVisible()

    await page.getByRole('link', { name: title, exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL(/column=in_review/)
    await expect(statusTab(page, 'in_review')).toHaveAttribute('aria-selected', 'true')

    await statusTab(page, 'accepted').click()
    await statusTab(page, 'new').click()
    await page.goBack()
    await expect(page).not.toHaveURL(/\/board/)
  })

  test('manager: default column is «На проверке» and the comment dialog fits', async ({ page }) => {
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const seed = await seedBoard(m, a, { wait: 'in_review' })
    const { title } = seed.task('wait')
    await login(page, m)
    await page.setViewportSize({ width: 320, height: 640 })
    await page.goto(`/board?object=${seed.objectId}`)
    await expect(statusTab(page, 'in_review')).toHaveAttribute('aria-selected', 'true')
    const card = cardOf(page.getByRole('tabpanel'), title)
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: TRANSITION_LABEL.rework }).click()
    const dialog = page.getByRole('dialog', { name: TRANSITION_LABEL.rework })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect.poll(() => focusIsOnBody(page)).toBe(false)
  })

  test('nav item opens the board on a phone', async ({ page }) => {
    const a = await createUser('executor', 'a')
    await login(page, a)
    await openBoardFromNav(page)
    await expect(boardHeading(page)).toBeVisible()
  })
})

test.describe('board: multi-select object filter', () => {
  test.skip(({ isMobile }) => isMobile, 'popover behaviour is checked once on desktop')

  async function managerWithObjects(count: number, token: string) {
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const rows = Array.from({ length: count }, (_, i) => ({
      name: `Фильтр ${token} ${String(i + 1).padStart(2, '0')}`,
      address: 'Адрес e2e',
    }))
    const { data, error } = await m.client.from('objects').insert(rows).select('id, name')
    if (error) throw error
    return { m, a, objects: data.sort((x, y) => x.name.localeCompare(y.name)) }
  }

  test('two objects: only their tasks, totals follow, F5 and history keep both, chips remove and reset', async ({
    page,
  }) => {
    const token = uid()
    const { m, a, objects } = await managerWithObjects(3, token)
    const titles: string[] = []
    for (const target of objects) {
      const title = `Задача ${uid()}`
      await createTask(m, target.id, a, title)
      titles.push(title)
    }
    await login(page, m)
    await page.goto('/board')
    await expect(boardHeading(page)).toBeVisible()

    const first = objects[0]
    const second = objects[1]
    if (!first || !second) throw new Error('objects were not created')
    await toggleObject(page, first.name)
    await toggleObject(page, second.name)
    await expect(filterSearch(page), 'the popover stays open while toggling').toBeVisible()
    await closeFilter(page)

    await expect(page).toHaveURL(new RegExp(`object=${first.id}.*object=${second.id}`))
    await expect(objectFilter(page)).toContainText('Выбрано объектов: 2')
    await expect(page.getByRole('link', { name: titles[0] ?? '', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: titles[1] ?? '', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: titles[2] ?? '', exact: true })).toHaveCount(0)
    expect(await columnTotal(page, 'new'), 'the total counts only the chosen objects').toBe(2)

    await page.reload()
    await expect(page).toHaveURL(new RegExp(`object=${first.id}.*object=${second.id}`))
    await expect(page.getByRole('link', { name: titles[1] ?? '', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: titles[2] ?? '', exact: true })).toHaveCount(0)

    const chips = page.getByRole('list', { name: 'Выбранные объекты' })
    await chips.getByRole('button', { name: `Убрать «${first.name}»` }).click()
    await expect(page).toHaveURL(new RegExp(`object=${second.id}`))
    await expect(page).not.toHaveURL(new RegExp(`object=${first.id}`))
    await expect(page.getByRole('button', { name: 'Сбросить', exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: titles[0] ?? '', exact: true })).toHaveCount(0)

    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`object=${first.id}`))
    await expect(page.getByRole('button', { name: 'Сбросить', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Сбросить', exact: true }).click()
    await expect(page).not.toHaveURL(/object=/)
    await expect(objectFilter(page)).toContainText('Все объекты')
  })

  test('search is server-side, narrows the options, and selecting from the results works', async ({
    page,
  }) => {
    const token = uid()
    const { m, objects } = await managerWithObjects(3, token)
    const target = objects[2]
    if (!target) throw new Error('objects were not created')
    await login(page, m)
    await page.goto('/board')
    await objectFilter(page).click()
    const request = page.waitForRequest(
      (r) => r.url().includes('/rest/v1/objects') && decodeURIComponent(r.url()).includes(token),
    )
    await filterSearch(page).fill(token)
    await request
    await expect(page.getByRole('option', { name: new RegExp(token) })).toHaveCount(3)

    await filterSearch(page).fill(target.name)
    await expect(page.getByRole('option', { name: new RegExp(token) })).toHaveCount(1)
    await page.getByRole('option', { name: target.name }).click()
    await closeFilter(page)
    await expect(page).toHaveURL(new RegExp(`object=${target.id}`))
    await expect(objectFilter(page)).toContainText(target.name)
  })

  test('the list loads more options while scrolling (more than 20 reachable)', async ({ page }) => {
    const token = uid()
    const { m } = await managerWithObjects(25, token)
    await login(page, m)
    await page.goto('/board')
    await objectFilter(page).click()
    await filterSearch(page).fill(token)
    const options = page.getByRole('option', { name: new RegExp(token) })
    await expect(options).toHaveCount(20)
    await expect(filterPopover(page).getByText('Показано 20 из 25')).toBeVisible()

    await page.getByRole('listbox').evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await expect.poll(() => options.count(), { timeout: 10_000 }).toBe(25)
  })

  test('at most 10 objects: the others are disabled and the hint explains why', async ({
    page,
  }) => {
    const token = uid()
    const { m, objects } = await managerWithObjects(11, token)
    await login(page, m)
    const query = objects
      .slice(0, 10)
      .map((target) => `object=${target.id}`)
      .join('&')
    await page.goto(`/board?${query}`)
    await expect(objectFilter(page)).toContainText('Выбрано объектов: 10')
    await objectFilter(page).click()
    await filterSearch(page).fill(token)
    const eleventh = objects[10]
    if (!eleventh) throw new Error('objects were not created')
    await expect(page.getByRole('option', { name: eleventh.name })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await expect(filterPopover(page).getByText('Можно выбрать не больше 10 объектов')).toBeVisible()
    await page.getByRole('option', { name: eleventh.name }).click({ force: true })
    await expect(page).not.toHaveURL(new RegExp(`object=${eleventh.id}`))
  })

  test('an unavailable id is dropped from the URL with a notice, the rest stays', async ({
    page,
  }) => {
    const token = uid()
    const { m, objects } = await managerWithObjects(1, token)
    const kept = objects[0]
    if (!kept) throw new Error('objects were not created')
    await login(page, m)
    await page.goto(`/board?object=${kept.id}&object=${crypto.randomUUID()}`)
    await expect(page.getByText('Часть объектов недоступна и убрана из фильтра')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`object=${kept.id}`))
    expect(page.url().match(/object=/g)).toHaveLength(1)
    await expect(objectFilter(page)).toContainText(kept.name)
  })

  test('two chosen objects without tasks: «В выбранных объектах нет задач»', async ({ page }) => {
    const token = uid()
    const { m, objects } = await managerWithObjects(2, token)
    await login(page, m)
    await page.goto(`/board?${objects.map((target) => `object=${target.id}`).join('&')}`)
    await expect(page.getByText('В выбранных объектах нет задач')).toBeVisible()
  })
})

const MORE_BUTTON = /^\+\d+: показать остальные выбранные объекты/
const CHIP_GAP = 6

interface Box {
  left: number
  right: number
  top: number
  bottom: number
  height: number
}

interface ChipsSnapshot {
  row: Box
  shown: { name: string; box: Box }[]
  hiddenNames: string[]
  more: Box
  moreCount: number
  reset: Box | null
  pageOverflow: number
}

/** Geometry of the selected-object line, measured from the «+N» button that sits in it. */
function chipsSnapshot(page: Page): Promise<ChipsSnapshot> {
  return page.getByRole('button', { name: MORE_BUTTON }).evaluate((more) => {
    const row = more.closest('div') ?? more
    const boxOf = (el: Element): Box => {
      const r = el.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height }
    }
    const shown: ChipsSnapshot['shown'] = []
    const hiddenNames: string[] = []
    for (const item of Array.from(row.querySelector('ul')?.children ?? [])) {
      const name = item.querySelector('button')?.getAttribute('aria-label') ?? ''
      if (getComputedStyle(item).visibility === 'hidden') hiddenNames.push(name)
      else shown.push({ name, box: boxOf(item) })
    }
    const reset = Array.from(row.children).find((el) => el.textContent === 'Сбросить')
    const root = document.documentElement
    return {
      row: boxOf(row),
      shown,
      hiddenNames,
      more: boxOf(more),
      moreCount: Number(/^\+(\d+)/.exec(more.textContent)?.[1] ?? Number.NaN),
      reset: reset ? boxOf(reset) : null,
      pageOverflow: root.scrollWidth - root.clientWidth,
    }
  })
}

/** Snapshot taken once all `total` chips are present and the line has stopped changing. */
async function settledSnapshot(page: Page, total: number): Promise<ChipsSnapshot> {
  const seen = { key: '' }
  await expect
    .poll(async () => {
      const snap = await chipsSnapshot(page)
      const key = JSON.stringify([snap.shown.map((chip) => chip.name), snap.hiddenNames])
      const settled = key === seen.key && snap.shown.length + snap.hiddenNames.length === total
      seen.key = key
      return settled
    })
    .toBe(true)
  return chipsSnapshot(page)
}

const removeLabel = (name: string): string => `Убрать «${name}»`
const removalName = (label: string): string => label.slice('Убрать «'.length, -1)

async function managerWithTenObjects() {
  const token = uid()
  const m = await createUser('manager', 'm')
  const rows = Array.from({ length: 10 }, (_, i) => ({
    name: `Выбор ${token} ${String(i + 1).padStart(2, '0')} с очень длинным названием объекта`,
    address: 'Адрес e2e',
  }))
  const { data, error } = await m.client.from('objects').insert(rows).select('id, name')
  if (error) throw error
  const objects = data.sort((x, y) => x.name.localeCompare(y.name))
  return { m, objects, query: objects.map((o) => `object=${o.id}`).join('&') }
}

test.describe('board: selected objects in one line', () => {
  test.skip(({ isMobile }) => isMobile, 'width is set explicitly per case; run once on desktop')

  for (const width of [1280, 320]) {
    test(`${String(width)} px: one line, «+N» after the last chip, popover lists the hidden ones`, async ({
      page,
    }) => {
      const { m, objects, query } = await managerWithTenObjects()
      await login(page, m)
      await page.setViewportSize({ width, height: 800 })
      await page.goto(`/board?${query}`)
      await expect(objectFilter(page)).toContainText('Выбрано объектов: 10')
      const moreButton = page.getByRole('button', { name: MORE_BUTTON })
      await expect(moreButton).toBeVisible()

      const stable = { value: '' }
      await expect
        .poll(async () => {
          const current = await chipsSnapshot(page)
          const next = JSON.stringify([
            current.shown.length + current.hiddenNames.length,
            current.shown.map((s) => s.name),
          ])
          const same = next === stable.value
          stable.value = next
          return same && current.shown.length + current.hiddenNames.length === objects.length
        })
        .toBe(true)

      const snap = await chipsSnapshot(page)
      expect(snap.shown.length, 'at least one chip is in the line').toBeGreaterThanOrEqual(1)
      expect(snap.hiddenNames.length).toBeGreaterThanOrEqual(1)
      expect(snap.moreCount, '«+N» equals the chips that are not shown').toBe(
        snap.hiddenNames.length,
      )
      expect(snap.shown.length + snap.hiddenNames.length).toBe(objects.length)
      expect(snap.pageOverflow, 'no horizontal page scroll').toBeLessThanOrEqual(0)

      const line = [...snap.shown.map((s) => s.box), snap.more, ...(snap.reset ? [snap.reset] : [])]
      expect(snap.reset, '«Сбросить» follows with two or more selected').not.toBeNull()
      for (const box of line) {
        expect(Math.abs(box.top - snap.more.top), 'same line').toBeLessThanOrEqual(1)
        expect(box.left).toBeGreaterThanOrEqual(snap.row.left - 0.5)
        expect(box.right).toBeLessThanOrEqual(snap.row.right + 0.5)
        if (width < 640) expect(box.height).toBeGreaterThanOrEqual(43.5)
      }
      for (const chip of snap.shown) {
        expect(chip.box.right - chip.box.left, 'chip is at most 10rem').toBeLessThanOrEqual(160.5)
      }
      const last = snap.shown.at(-1)
      if (!last || !snap.reset) throw new Error('no last chip or reset')
      expect(snap.more.left - last.box.right, '«+N» sits right after the last chip').toBeCloseTo(
        CHIP_GAP,
        0,
      )
      expect(snap.reset.left - snap.more.right).toBeCloseTo(CHIP_GAP, 0)
      expect(snap.shown.map((s) => removalName(s.name))).toEqual(
        objects.slice(0, snap.shown.length).map((o) => o.name),
      )
      if (width >= 640) {
        const combobox = await objectFilter(page).boundingBox()
        expect(snap.row.left, 'chips sit next to the combobox').toBeGreaterThanOrEqual(
          (combobox?.x ?? 0) + (combobox?.width ?? 0) - 0.5,
        )
      } else {
        const combobox = await objectFilter(page).boundingBox()
        expect(snap.row.top, 'chips sit under the combobox').toBeGreaterThanOrEqual(
          (combobox?.y ?? 0) + (combobox?.height ?? 0) - 0.5,
        )
      }

      await page.getByRole('button', { name: removeLabel(removalName(last.name)) }).focus()
      await page.keyboard.press('Tab')
      await expect(moreButton, 'Tab skips the hidden chips').toBeFocused()

      await moreButton.click()
      const popover = page.getByRole('dialog', { name: 'Остальные выбранные объекты' })
      await expect(popover).toBeVisible()
      const listed = popover.getByRole('button')
      await expect(listed).toHaveCount(snap.hiddenNames.length)
      expect(
        await listed.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label'))),
      ).toEqual(snap.hiddenNames)

      const [firstHidden, secondHidden] = snap.hiddenNames
      if (!firstHidden || !secondHidden) throw new Error('need two hidden chips')
      const removedId = objects.find((o) => o.name === removalName(firstHidden))?.id ?? ''
      await popover.getByRole('button', { name: firstHidden }).click()
      await expect(page).not.toHaveURL(new RegExp(`object=${removedId}`))
      await expect(popover.getByRole('button', { name: firstHidden })).toHaveCount(0)
      await expect(popover.getByRole('button', { name: secondHidden })).toBeFocused()

      for (let guard = 0; guard < 10; guard++) {
        const remaining = await popover.getByRole('button').count()
        if (remaining === 0) break
        await popover.getByRole('button').first().click()
        await expect.poll(() => popover.getByRole('button').count()).toBeLessThan(remaining)
      }
      await expect(popover, 'the popover closes once everything fits').toBeHidden()
      await expect(moreButton).toHaveCount(0)
      const chipList = page.getByRole('list', { name: 'Выбранные объекты' })
      await expect(
        chipList.getByRole('button').last(),
        'focus lands on the last visible chip',
      ).toBeFocused()
      expect(await focusIsOnBody(page)).toBe(false)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0)
    })
  }

  test('removing a visible chip focuses its neighbour; the last one sends focus to the combobox', async ({
    page,
  }) => {
    const { m, objects } = await managerWithTenObjects()
    const [one, two] = objects
    if (!one || !two) throw new Error('objects were not created')
    await login(page, m)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`/board?object=${one.id}&object=${two.id}`)
    const chips = page.getByRole('list', { name: 'Выбранные объекты' })
    await expect(chips.getByRole('button')).toHaveCount(2)

    await chips.getByRole('button', { name: removeLabel(one.name) }).click()
    await expect(page).not.toHaveURL(new RegExp(`object=${one.id}`))
    await expect(chips.getByRole('button', { name: removeLabel(two.name) })).toBeFocused()

    await chips.getByRole('button', { name: removeLabel(two.name) }).click()
    await expect(page).not.toHaveURL(/object=/)
    await expect(objectFilter(page)).toBeFocused()
  })
})

test.describe('board: focus after removals', () => {
  test.skip(({ isMobile }) => isMobile, 'width is set explicitly per case; run once on desktop')

  test('removing the last visible chip with the keyboard keeps focus on a visible chip or «+N»', async ({
    page,
  }) => {
    const { m, query } = await managerWithTenObjects()
    await login(page, m)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`/board?${query}`)
    await expect(objectFilter(page)).toContainText('Выбрано объектов: 10')
    const moreButton = page.getByRole('button', { name: MORE_BUTTON })
    await expect(moreButton).toBeVisible()
    const before = await settledSnapshot(page, 10)
    const last = before.shown.at(-1)
    if (!last) throw new Error('no visible chip')

    await page.getByRole('button', { name: last.name }).focus()
    await page.keyboard.press('Enter')

    await expect(page.getByRole('button', { name: last.name })).toHaveCount(0)
    await expect.poll(() => focusIsOnBody(page)).toBe(false)
    const focusedName = await page.evaluate(
      () => document.activeElement?.getAttribute('aria-label') ?? '',
    )
    const visibleNow = (await chipsSnapshot(page)).shown.map((s) => s.name)
    expect(
      visibleNow.includes(focusedName) || MORE_BUTTON.test(focusedName),
      `focus is on a visible chip or «+N», got «${focusedName}»`,
    ).toBe(true)
  })

  test('no chip fits: only «+1» is in the line; removing from its popover focuses the combobox', async ({
    page,
  }) => {
    const m = await createUser('manager', 'm')
    const name = `Очень длинное название объекта ${uid()} ${'слово '.repeat(10)}`.trim()
    const { data, error } = await m.client
      .from('objects')
      .insert({ name, address: 'Адрес e2e' })
      .select('id')
      .single()
    if (error) throw error
    await login(page, m)
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style')
        style.textContent = 'html { font-size: 200% !important; }'
        document.head.append(style)
      })
    })
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto(`/board?object=${data.id}`)
    const moreButton = page.getByRole('button', {
      name: /^\+1: показать остальные выбранные объекты/,
    })
    await expect(moreButton).toBeVisible()
    await expect(page.getByRole('list', { name: 'Выбранные объекты' })).toHaveCount(0)

    await moreButton.click()
    const popover = page.getByRole('dialog', { name: 'Остальные выбранные объекты' })
    await popover.getByRole('button', { name: removeLabel(name) }).click()
    await expect(page).not.toHaveURL(/object=/)
    await expect(objectFilter(page)).toBeFocused()
  })

  test('320 px: removing the only visible chip while one is hidden leaves focus on a visible element', async ({
    page,
  }) => {
    const { m, objects } = await managerWithTenObjects()
    const [first, second] = objects
    if (!first || !second) throw new Error('objects were not created')
    await login(page, m)
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/board?object=' + first.id + '&object=' + second.id)
    await expect(page.getByRole('button', { name: /^\+1: показать/ })).toBeVisible()
    await expect
      .poll(async () => {
        const snap = await chipsSnapshot(page)
        return [snap.shown.length, snap.hiddenNames.length]
      })
      .toEqual([1, 1])

    await settledSnapshot(page, 2)
    await page.getByRole('button', { name: removeLabel(first.name) }).focus()
    await page.keyboard.press('Enter')

    await expect(page).not.toHaveURL(new RegExp('object=' + first.id))
    await expect(page).toHaveURL(new RegExp('object=' + second.id))
    await expect.poll(() => focusIsOnBody(page)).toBe(false)
    await expect
      .poll(() =>
        page.evaluate(() => {
          const el = document.activeElement
          if (!el || el === document.body) return 'body'
          const rect = el.getBoundingClientRect()
          const visible = getComputedStyle(el).visibility === 'visible' && rect.width > 0
          const label = el.getAttribute('aria-label') ?? ''
          return visible
            ? label === ''
              ? 'visible:' + String(el.getAttribute('role'))
              : label
            : 'invisible'
        }),
      )
      .toBe(removeLabel(second.name))
  })

  test('«Сбросить» clears the selection and sends focus to the combobox', async ({ page }) => {
    const { m, query } = await managerWithTenObjects()
    await login(page, m)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/board?' + query)
    const reset = page.getByRole('button', { name: 'Сбросить', exact: true })
    await expect(reset).toBeVisible()

    await reset.focus()
    await page.keyboard.press('Enter')

    await expect(page).not.toHaveURL(/object=/)
    await expect(objectFilter(page)).toBeFocused()
  })
})

test.describe('board: filter on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch layout')

  test('the object filter trigger is a 44 px target and its popover fits at 320', async ({
    page,
  }) => {
    const m = await createUser('manager', 'm')
    await login(page, m)
    await page.setViewportSize({ width: 320, height: 640 })
    await page.goto('/board')
    await expect(boardHeading(page)).toBeVisible()
    const trigger = await objectFilter(page).boundingBox()
    expect(trigger?.height ?? 0).toBeGreaterThanOrEqual(43.5)
    await objectFilter(page).click()
    const popover = await filterPopover(page).boundingBox()
    expect(popover?.x ?? -1).toBeGreaterThanOrEqual(0)
    expect((popover?.x ?? 0) + (popover?.width ?? 0)).toBeLessThanOrEqual(320.5)
  })
})
