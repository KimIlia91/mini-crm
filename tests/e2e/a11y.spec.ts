/// <reference lib="dom" />
import type { Locator, Page } from '@playwright/test'

import {
  goToSection,
  mainNav,
  newUserPage,
  openObjectsFiltered,
  SIDEBAR_TOGGLE,
  useDarkTheme,
  usesSidebarSheet,
} from './app-helpers'
import {
  createObject,
  createTask,
  createUser,
  expect,
  expectNoA11yViolations,
  login,
  test,
} from './fixtures'
import { auditState, LONG } from './layout-helpers'

// P-items of ui-layout.md §6 that journeys.spec / layout.spec do not cover: keyboard journeys, skip
// link, titles, landmarks and structure, focus visibility, zoom / text spacing, reduced motion and
// axe in the dark theme. Runs in both projects (desktop and mobile emulation).

const uid = () => crypto.randomUUID().slice(0, 8)

/** Presses Tab until `target` has focus; fails when it is not reachable (focus order / keyboard trap). */
async function tabTo(page: Page, target: Locator, maxTabs = 80): Promise<number> {
  await expect(target).toBeVisible()
  for (let presses = 1; presses <= maxTabs; presses++) {
    await page.keyboard.press('Tab')
    const focused = await target
      .evaluate((el) => el === document.activeElement, undefined, { timeout: 1_000 })
      .catch(() => false)
    if (focused) return presses
  }
  throw new Error(
    `${target.toString()} is not reachable with Tab within ${String(maxTabs)} presses`,
  )
}

const focusIsInside = (container: Locator) =>
  container.evaluate((el) => el.contains(document.activeElement))

test.describe('keyboard-only journeys', () => {
  test('executor: login -> my tasks -> open a task -> take it into work', async ({ page }) => {
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const title = `Задача ${uid()}`
    const objectId = await createObject(m, `Объект ${uid()}`)
    await createTask(m, objectId, a, title)

    await page.goto('/login')
    await tabTo(page, page.getByLabel('Email'))
    await page.keyboard.type(a.email)
    await page.keyboard.press('Tab')
    await expect(page.getByLabel('Пароль')).toBeFocused()
    await page.keyboard.type(a.password)
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(/\/my-tasks$/, { timeout: 20_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Мои задачи' })).toBeVisible()

    const taskLink = page.getByRole('link', { name: title, exact: true })
    await tabTo(page, taskLink)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()

    const take = page.getByRole('button', { name: 'Взять в работу' })
    await tabTo(page, take)
    // Shift+Tab leaves the button and Tab comes back: no trap, symmetric order.
    await page.keyboard.press('Shift+Tab')
    await expect(take).not.toBeFocused()
    await page.keyboard.press('Tab')
    await expect(take).toBeFocused()
    await page.keyboard.press('Space')
    await expect(page.getByText('В работе', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Отправить на проверку' })).toBeVisible()
  })

  test('manager: dialog (trap, Esc, focus return) and the row actions menu', async ({ page }) => {
    const m = await createUser('manager', 'm')
    const token = uid()
    const name = `Объект ${token}`
    await createObject(m, name, 'Адрес')
    await login(page, m)
    await openObjectsFiltered(page, token)

    // Dialog: opens with Enter, keeps Tab / Shift+Tab inside, Esc closes and returns focus.
    const add = page.getByRole('button', { name: 'Добавить объект' })
    await tabTo(page, add)
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Добавить объект' })
    await expect(dialog).toBeVisible()
    await expect.poll(() => focusIsInside(dialog)).toBe(true)
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab')
      expect(await focusIsInside(dialog), `Tab #${String(i + 1)} left the dialog`).toBe(true)
    }
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Shift+Tab')
      expect(await focusIsInside(dialog), `Shift+Tab #${String(i + 1)} left the dialog`).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(add).toBeFocused()

    // Row menu: Enter opens, arrows move, Enter on «Удалить» opens the confirmation, Esc cancels.
    const rowActions = page.getByRole('button', { name: `Действия с объектом «${name}»` })
    await tabTo(page, rowActions)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menuitem', { name: 'Редактировать' })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem', { name: 'Удалить' })).toBeFocused()
    await page.keyboard.press('Enter')
    const confirm = page.getByRole('alertdialog', { name: 'Удалить объект?' })
    await expect(confirm).toBeVisible()
    await expect(confirm.getByRole('button', { name: 'Отмена' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(confirm).toBeHidden()
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible()

    // Forbidden path: the object is still there for the API too (nothing was deleted).
    const { data } = await m.client.from('objects').select('id').eq('name', name)
    expect(data).toHaveLength(1)
  })

  test('skip link is the first Tab stop and moves focus to the main landmark', async ({ page }) => {
    const m = await createUser('manager', 'm')
    await login(page, m)
    await page.goto('/objects')
    await expect(page.getByRole('heading', { level: 1, name: 'Объекты' })).toBeVisible()

    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'К содержимому' })
    await expect(skip).toBeFocused()
    await expect(skip).toBeInViewport()

    await page.keyboard.press('Enter')
    const main = page.getByRole('main')
    await expect(main).toBeFocused()
    await page.keyboard.press('Tab')
    expect(await focusIsInside(main), 'the next Tab after the skip link stays in main').toBe(true)
  })
})

test.describe('document structure', () => {
  test('every route has its own document.title', async ({ page, browser }) => {
    const [m, a, newbie] = await Promise.all([
      createUser('manager', 'm'),
      createUser('executor', 'a'),
      createUser('executor', 'newbie', { active: false }),
    ])
    const token = uid()
    const objectName = `Объект ${token}`
    const taskTitle = `Задача ${token}`
    const objectId = await createObject(m, objectName)
    await createTask(m, objectId, a, taskTitle)
    const titles: string[] = []
    const expectTitle = async (p: Page, title: string) => {
      await expect(p).toHaveTitle(title)
      titles.push(title)
    }

    await page.goto('/login')
    await expectTitle(page, 'Вход в Mini-CRM — Mini-CRM')
    await page.goto(`/nothing-${uid()}`)
    await expectTitle(page, 'Страница не найдена — Mini-CRM')
    await page.goto('/about')
    await expectTitle(page, 'О проекте — Mini-CRM')

    await login(page, m)
    await expectTitle(page, 'Объекты — Mini-CRM')
    // Client-side navigation updates the title as well.
    await page.getByRole('searchbox', { name: 'Поиск по названию и адресу' }).fill(token)
    await page.getByRole('link', { name: objectName, exact: true }).click()
    await expectTitle(page, `${objectName} — Mini-CRM`)
    await page.getByRole('link', { name: taskTitle, exact: true }).click()
    await expectTitle(page, `${taskTitle} — Mini-CRM`)
    await page.goto(`/objects/${crypto.randomUUID()}`)
    await expectTitle(page, 'Объект не найден или недоступен — Mini-CRM')
    await page.goto(`/tasks/${crypto.randomUUID()}`)
    await expectTitle(page, 'Задача не найдена или недоступна — Mini-CRM')

    const executor = await newUserPage(browser)
    await login(executor, a)
    await expectTitle(executor, 'Мои задачи — Mini-CRM')

    const first = await newUserPage(browser)
    await login(first, newbie, { expectSuccess: false })
    await expectTitle(first, 'Смена пароля — Mini-CRM')

    expect(new Set(titles).size, `titles must be unique: ${titles.join(' | ')}`).toBe(titles.length)
  })

  test('landmarks, one h1, heading order and aria-current on every app screen', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000)
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const objectId = await createObject(m, `Объект ${uid()}`)
    const taskId = await createTask(m, objectId, a, `Задача ${uid()}`)

    async function expectStructure(
      p: Page,
      where: string,
      current: 'Объекты' | 'Мои задачи' | null,
    ) {
      const at = (what: string) => `${where}: ${what}`
      await expect(p.getByRole('heading', { level: 1 }), at('page rendered')).toBeVisible()
      await expect(p.getByRole('main'), at('exactly one main')).toHaveCount(1)
      await expect
        .soft(p.getByRole('banner'), at('exactly one banner (header) landmark'))
        .toHaveCount(1, { timeout: 1_000 })
      await expect(p.getByRole('heading', { level: 1 }), at('exactly one h1')).toHaveCount(1)
      const levels = await p
        .getByRole('heading')
        .evaluateAll((els) =>
          els.map((el) => Number(el.getAttribute('aria-level') ?? el.tagName[1])),
        )
      levels.forEach((level, index) => {
        const previous = levels[index - 1] ?? 0
        expect(
          level,
          at(`heading levels ${levels.join(',')} must not skip a level`),
        ).toBeLessThanOrEqual(previous + 1)
      })

      // The sidebar navigation: a sheet on narrow screens.
      if (usesSidebarSheet(p)) await p.getByRole('button', { name: SIDEBAR_TOGGLE }).click()
      const nav = mainNav(p)
      await expect(nav, at('main navigation landmark')).toBeVisible()
      if (current !== null) {
        await expect(nav.getByRole('link', { name: current, exact: true })).toHaveAttribute(
          'aria-current',
          'page',
        )
      }
      const links = nav.getByRole('link')
      const others = current === null ? links : links.filter({ hasNotText: current })
      for (const link of await others.all()) {
        await expect(link, at('only the current link has aria-current')).not.toHaveAttribute(
          'aria-current',
          'page',
        )
      }
      const names = await p
        .getByRole('navigation')
        .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
      expect(names.every(Boolean), at(`every navigation is labelled: ${names.join(',')}`)).toBe(
        true,
      )
      expect(new Set(names).size, at('navigation labels are unique')).toBe(names.length)
      if (usesSidebarSheet(p)) {
        await p.keyboard.press('Escape')
        await expect(nav).toBeHidden()
      }
    }

    await login(page, m)
    for (const path of ['/objects', `/objects/${objectId}`, `/tasks/${taskId}`]) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      // The task page is not under /objects, so no sidebar link is current there.
      const current = path.startsWith('/tasks/') ? null : 'Объекты'
      await expectStructure(page, `manager ${path.replace(/[0-9a-f-]{36}/, ':id')}`, current)
    }

    const executor = await newUserPage(browser)
    await login(executor, a)
    await expectStructure(executor, 'executor /my-tasks', 'Мои задачи')
    await goToSection(executor, 'Объекты')
    await expectStructure(executor, 'executor /objects', 'Объекты')
  })

  test('data tables: name, column scope and aria-sort that follows the sorting', async ({
    page,
  }) => {
    const m = await createUser('manager', 'm')
    const a = await createUser('executor', 'a')
    const token = uid()
    const objectId = await createObject(m, `Объект ${token}`)
    await createTask(m, objectId, a, `Задача ${token}`)
    await login(page, m)

    for (const [path, tableName] of [
      [`/objects?q=${token}`, 'Список объектов'],
      [`/objects/${objectId}`, 'Задачи объекта'],
    ] as const) {
      await page.goto(path)
      await expect(page.getByRole('table', { name: tableName })).toBeVisible()
      const headers = await page.getByRole('columnheader').evaluateAll((ths) =>
        ths.map((th) => ({
          scope: th.getAttribute('scope'),
          sort: th.getAttribute('aria-sort'),
          sortable: th.querySelector('button') !== null,
        })),
      )
      expect(headers.length, `${tableName}: has column headers`).toBeGreaterThan(0)
      for (const h of headers) {
        expect(h.scope, `${tableName}: th scope`).toBe('col')
        if (h.sortable) expect(['none', 'ascending', 'descending']).toContain(h.sort)
      }
    }

    // Sorting through the header menu is reflected in aria-sort.
    const header = page.getByRole('columnheader', { name: /Название/ })
    await header.getByRole('button').click()
    await page.getByRole('menuitem', { name: 'По возрастанию' }).click()
    await expect(header).toHaveAttribute('aria-sort', 'ascending')
    await header.getByRole('button').click()
    await page.getByRole('menuitem', { name: 'По убыванию' }).click()
    await expect(header).toHaveAttribute('aria-sort', 'descending')
  })
})

test.describe('focus visibility and not obscured (2.4.7, 2.4.11)', () => {
  /** Tabs through the page; every focused element must be on screen and not covered by another one. */
  async function expectEveryFocusStopVisible(page: Page, where: string): Promise<void> {
    await page.evaluate(() => {
      document.querySelectorAll('[data-e2e-stop]').forEach((el) => {
        el.removeAttribute('data-e2e-stop')
      })
    })
    const problems: string[] = []
    for (let stop = 0; stop < 120; stop++) {
      await page.keyboard.press('Tab')
      const result = await page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body || el === document.documentElement) return { end: true }
        if (el.hasAttribute('data-e2e-stop')) return { end: true }
        el.setAttribute('data-e2e-stop', '')
        const label = `<${el.tagName.toLowerCase()}> "${(el.getAttribute('aria-label') ?? el.textContent).trim().replace(/\s+/g, ' ').slice(0, 40)}"`
        const rect = el.getBoundingClientRect()
        const vw = document.documentElement.clientWidth
        const vh = window.innerHeight
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        if (cx < 0 || cy < 0 || cx > vw || cy > vh)
          return { label, problem: 'outside the viewport' }
        const top = document.elementFromPoint(cx, cy)
        const ok = top !== null && (top === el || el.contains(top))
        if (ok) return { label }
        const covering = top
          ? `<${top.tagName.toLowerCase()} class="${(top.getAttribute('class') ?? '').slice(0, 40)}">`
          : 'nothing'
        return { label, problem: `covered by ${covering}` }
      })
      if (result.end) break
      if (result.problem) problems.push(`${result.label}: ${result.problem}`)
    }
    expect(problems, `${where}: focused elements must not be hidden`).toEqual([])
  }

  test('object page with many tasks: no focus stop is covered by the header or sidebar', async ({
    page,
  }) => {
    const m = await createUser('manager', LONG.userLabel)
    const a = await createUser('executor', 'a')
    const objectId = await createObject(m, `Объект ${uid()}`, LONG.address)
    for (let i = 1; i <= 12; i++) await createTask(m, objectId, a, `Задача ${uid()} ${String(i)}`)
    await login(page, m)

    await page.goto(`/objects/${objectId}`)
    await expect(page.getByRole('table', { name: 'Задачи объекта' })).toBeVisible()
    await expectEveryFocusStopVisible(page, 'object page, default viewport')

    await page.setViewportSize({ width: 320, height: 480 })
    await page.goto(`/objects/${objectId}`)
    await expect(page.getByRole('table', { name: 'Задачи объекта' })).toBeVisible()
    await expectEveryFocusStopVisible(page, 'object page, 320x480')
  })
})

test.describe('zoom 200% and text spacing (1.4.4, 1.4.12)', () => {
  const ZOOM = 'html { font-size: 200% !important; }'
  const SPACING =
    '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }'

  test('objects list and task page keep their content', async ({ page }) => {
    const m = await createUser('manager', LONG.userLabel)
    const a = await createUser('executor', LONG.userLabel)
    const token = uid()
    const objectId = await createObject(
      m,
      `${token}-${LONG.objectName}`.slice(0, 200),
      LONG.address,
    )
    const taskId = await createTask(
      m,
      objectId,
      a,
      `${token}-${LONG.taskTitle}`.slice(0, 200),
      LONG.description,
    )
    for (const to of ['in_progress', 'in_review'] as const) {
      const { error } = await a.client.rpc('change_task_status', {
        p_task_id: taskId,
        p_to_status: to,
      })
      if (error) throw error
    }
    const { error } = await m.client.rpc('change_task_status', {
      p_task_id: taskId,
      p_to_status: 'rework',
      p_comment: LONG.comment,
    })
    if (error) throw error
    await login(page, m)

    const viewport = page.viewportSize() ?? { width: 1280, height: 720 }
    const cases = [
      {
        screen: 'objects',
        open: async () => {
          await openObjectsFiltered(page, token)
          await expect(page.getByRole('link', { name: LONG.word, exact: false })).toBeVisible()
        },
      },
      {
        screen: 'task',
        open: async () => {
          await page.goto(`/tasks/${taskId}`)
          await expect(page.getByRole('note', { name: 'Замечание постановщика' })).toBeVisible()
        },
      },
    ]
    for (const c of cases) {
      for (const [state, css] of [
        ['zoom200', ZOOM],
        ['text-spacing', SPACING],
        ['zoom200-and-spacing', `${ZOOM} ${SPACING}`],
      ] as const) {
        await c.open()
        await page.addStyleTag({ content: css })
        await auditState(page, { screen: `a11y-${c.screen}`, state, viewport, axe: false })
      }
    }
  })
})

test.describe('reduced motion (2.3.3)', () => {
  /** Longest transition / animation duration (seconds) among all elements of the document. */
  const longestMotion = (page: Page) =>
    page.evaluate(() => {
      const seconds = (value: string) =>
        Math.max(
          0,
          ...value.split(',').map((part) => {
            const v = parseFloat(part)
            return part.trim().endsWith('ms') ? v / 1000 : v
          }),
        )
      let longest = 0
      let where = ''
      for (const el of document.querySelectorAll('*')) {
        const s = getComputedStyle(el)
        for (const value of [s.transitionDuration, s.animationDuration]) {
          const d = seconds(value)
          if (d > longest) {
            longest = d
            where = `<${el.tagName.toLowerCase()} data-slot="${el.getAttribute('data-slot') ?? ''}">`
          }
        }
      }
      return { longest, where }
    })

  test('sidebar, sheets, dialogs and menus do not animate', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const m = await createUser('manager', 'm')
    const objectId = await createObject(m, `Объект ${uid()}`)
    await login(page, m)
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
      true,
    )

    const expectStill = async (state: string) => {
      const { longest, where } = await longestMotion(page)
      expect(
        longest,
        `${state}: ${where} still animates for ${String(longest)}s`,
      ).toBeLessThanOrEqual(0.001)
    }

    await page.goto('/objects')
    await expect(page.getByRole('heading', { level: 1, name: 'Объекты' })).toBeVisible()
    await expectStill('objects page')

    // Sidebar: permanent (collapses) on desktop, a sheet on narrow screens.
    await page.getByRole('button', { name: SIDEBAR_TOGGLE }).click()
    await expectStill(usesSidebarSheet(page) ? 'sidebar sheet open' : 'sidebar collapsing')
    if (usesSidebarSheet(page)) {
      await page.keyboard.press('Escape')
    } else {
      await page.getByRole('button', { name: SIDEBAR_TOGGLE }).click()
    }

    await page.getByRole('button', { name: 'Добавить объект' }).click()
    await expect(page.getByRole('dialog', { name: 'Добавить объект' })).toBeVisible()
    await expectStill('dialog open')
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Сменить тему' }).click()
    await expect(page.getByRole('menu')).toBeVisible()
    await expectStill('menu open')
    await page.keyboard.press('Escape')

    await page.goto(`/objects/${objectId}`)
    await page.getByRole('button', { name: 'Добавить задачу' }).click()
    await expect(page.getByRole('dialog', { name: 'Новая задача' })).toBeVisible()
    await expectStill('task sheet open')
  })
})

test.describe('dark theme: axe on the key screens', () => {
  test('objects, object, task and my tasks have no serious violations', async ({
    page,
    browser,
  }) => {
    await useDarkTheme(page)
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const token = uid()
    const objectId = await createObject(m, `Объект ${token}`, 'Адрес')
    const taskId = await createTask(m, objectId, a, `Задача ${token}`, 'Описание')
    await login(page, m)
    await expect(page.locator('html')).toHaveClass(/dark/)

    for (const path of [`/objects?q=${token}`, `/objects/${objectId}`, `/tasks/${taskId}`]) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(
        page
          .getByRole('table')
          .or(page.getByRole('heading', { level: 2 }))
          .first(),
      ).toBeVisible()
      await expectNoA11yViolations(page)
    }

    const executor = await newUserPage(browser)
    await useDarkTheme(executor)
    await login(executor, a)
    await expect(executor.getByRole('table', { name: 'Мои задачи' })).toBeVisible()
    await expect(executor.locator('html')).toHaveClass(/dark/)
    await expectNoA11yViolations(executor)
  })
})
