import type { Locator, Page } from '@playwright/test'

import {
  createObject,
  createTask,
  createUser,
  expect,
  login,
  settleAnimations,
  test,
  type E2EUser,
} from './fixtures'
import { bell, bellPopover, toastWith, watchRealtime } from './realtime-helpers'
import type { Database } from '../../src/shared/api/database.types'
import {
  NAV_LABEL,
  SIDEBAR_TOGGLE,
  openObjectsFiltered,
  profileButton,
  signOut,
  useDarkTheme,
  usesSidebarSheet,
} from './app-helpers'
import {
  auditState,
  expectEscapeClosesAndRestoresFocus,
  expectFocusInside,
  LONG,
  resize,
  VIEWPORTS,
  type Viewport,
} from './layout-helpers'

// The layout audit sets the viewport explicitly for every case (320/375/768/1280), so the device
// emulation of a project adds nothing: running it also in chromium-mobile would only duplicate every
// case with a different user agent / touch flag. It therefore runs once, in chromium-desktop.
test.skip(({ isMobile }) => isMobile, 'viewport is set explicitly per case; run once on desktop')
test.describe.configure({ timeout: 240_000 })

type TaskStatus = Database['public']['Enums']['task_status']

const uid = () => crypto.randomUUID().slice(0, 8)
const longObjectName = (token = uid()) => `${token}-${LONG.objectName}`.slice(0, 200)
const longTaskTitle = () => `${uid()}-${LONG.taskTitle}`.slice(0, 200)

async function move(actor: E2EUser, taskId: string, to: TaskStatus, comment?: string) {
  const { error } = await actor.client.rpc('change_task_status', {
    p_task_id: taskId,
    p_to_status: to,
    ...(comment ? { p_comment: comment } : {}),
  })
  if (error) throw error
}

interface DialogCase {
  page: Page
  screen: string
  viewport: Viewport
  /** State name of the open dialog (screenshot / failure label). */
  state: string
  /** Focus must return here after closing. */
  trigger: Locator
  /** Opens the dialog; by default a click on `trigger`. */
  open?: () => Promise<void>
  dialog: Locator
  /** Non-destructive dialogs must close with Escape and return focus to the trigger. */
  escape?: boolean
  /** Extra states inside the open dialog. */
  body?: (snap: (state: string) => Promise<void>) => Promise<void>
}

async function auditDialog(c: DialogCase): Promise<void> {
  const where = `${c.screen} / ${c.state} @ ${c.viewport.width}`
  const snap = (state: string) =>
    auditState(c.page, { screen: c.screen, state, viewport: c.viewport })
  if (c.open) await c.open()
  else await c.trigger.click()
  await expect(c.dialog).toBeVisible()
  await expectFocusInside(c.dialog, where)
  await snap(c.state)
  await c.body?.(snap)
  if (c.escape ?? true) {
    await expectEscapeClosesAndRestoresFocus(c.page, c.dialog, c.trigger, where)
  } else {
    await c.dialog.getByRole('button', { name: 'Отмена' }).click()
    await expect(c.dialog).toBeHidden()
  }
}

async function forViewports(page: Page, body: (vp: Viewport) => Promise<void>): Promise<void> {
  for (const vp of VIEWPORTS) {
    await resize(page, vp)
    await body(vp)
  }
}

const page$ = (page: Page, screen: string, vp: Viewport) => ({
  snap: (state: string) => auditState(page, { screen, state, viewport: vp }),
})

const rowActions = (page: Page, name: string) =>
  page.getByRole('button', { name: `Действия с объектом «${name}»` })

/** Opens the row menu of an object and picks an item. */
const openRowItem = (page: Page, name: string, item: 'Редактировать' | 'Удалить') => async () => {
  await rowActions(page, name).click()
  await page.getByRole('menuitem', { name: item }).click()
}

/** Opens the actions menu of the object/task page and picks an item. */
const openPageItem =
  (
    page: Page,
    menu: 'Действия с объектом' | 'Действия с задачей',
    item: 'Редактировать' | 'Удалить',
  ) =>
  async () => {
    await page.getByRole('button', { name: menu }).click()
    await page.getByRole('menuitem', { name: item }).click()
  }

/** Picks an executor in the shadcn Select of the task sheet. */
async function pickExecutor(sheet: Locator, page: Page, fullName: string): Promise<void> {
  await sheet.getByRole('combobox', { name: 'Исполнитель' }).click()
  await page.getByRole('option', { name: fullName }).click()
}

/** Status filter button of a data table (its accessible name carries the selected count). */
const statusFilter = (page: Page) => page.getByRole('button', { name: /^Статус/ })

/** Opens a menu-like popup, audits it, closes it with Escape and checks the focus comes back. */
async function auditMenu(
  page: Page,
  vp: Viewport,
  screen: string,
  state: string,
  trigger: Locator,
): Promise<void> {
  await trigger.click()
  await expect(page.getByRole('menu')).toBeVisible()
  await settleAnimations(page)
  if (vp.width < 768) {
    const box = await page.getByRole('menu').boundingBox()
    expect(box?.x ?? -1, `${screen} / ${state}: menu left gap @${vp.width}`).toBeGreaterThanOrEqual(
      15.5,
    )
    expect(
      vp.width - ((box?.x ?? 0) + (box?.width ?? 0)),
      `${screen} / ${state}: menu right gap @${vp.width}`,
    ).toBeGreaterThanOrEqual(15.5)
  }
  await auditState(page, { screen, state, viewport: vp })
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('menu'),
    `${screen} / ${state}: Escape did not close the menu`,
  ).toBeHidden()
  await expect
    .soft(trigger, `${screen} / ${state}: focus did not return to the trigger`)
    .toBeFocused()
}

test.describe('layout: anonymous screens', () => {
  test('login: empty and wrong-password states', async ({ page }) => {
    const a = await createUser('executor', 'a')
    await forViewports(page, async (vp) => {
      const { snap } = page$(page, 'login', vp)
      await page.goto('/login')
      await expect(page.getByRole('heading', { level: 1, name: 'Вход в Mini-CRM' })).toBeVisible()
      await snap('empty')
      await page.getByLabel('Email').fill(a.email)
      await page.getByLabel('Пароль').fill('Wrong-Password-1')
      await page.getByRole('button', { name: 'Войти' }).click()
      await expect(page.getByRole('alert')).toHaveText('Неверный email или пароль')
      await snap('wrong-password')
    })
  })

  test('change-password: empty, validation errors, mismatch', async ({ page }) => {
    const newbie = await createUser('executor', 'newbie', { active: false })
    await login(page, newbie, { expectSuccess: false })
    await expect(page).toHaveURL(/\/change-password$/)
    await forViewports(page, async (vp) => {
      const { snap } = page$(page, 'change-password', vp)
      await page.goto('/change-password')
      await expect(page.getByRole('heading', { level: 1, name: 'Смена пароля' })).toBeVisible()
      await snap('empty')
      await page.getByLabel('Новый пароль').fill('short')
      await page.getByLabel('Повторите пароль').fill('short')
      await page.getByRole('button', { name: 'Сменить пароль' }).click()
      await expect(page.getByText('Минимум 8 символов')).toBeVisible()
      await snap('short-password')
      await page.getByLabel('Новый пароль').fill('Long-Enough-1')
      await page.getByLabel('Повторите пароль').fill('Different-Long-1')
      await page.getByRole('button', { name: 'Сменить пароль' }).click()
      await expect(page.getByText('Пароли не совпадают')).toBeVisible()
      await snap('mismatch')
    })
  })
})

test.describe('layout: app shell', () => {
  test('sidebar (collapsed / sheet), profile menu, theme menu, sign-out confirm', async ({
    page,
  }) => {
    const m = await createUser('manager', LONG.userLabel)
    await login(page, m)

    await forViewports(page, async (vp) => {
      const screen = 'shell-manager'
      await page.goto('/objects')
      await expect(page.getByRole('heading', { level: 1, name: 'Объекты' })).toBeVisible()
      const toggle = page.getByRole('button', { name: SIDEBAR_TOGGLE })
      await auditState(page, { screen, state: 'default', viewport: vp })

      if (usesSidebarSheet(page)) {
        await auditDialog({
          page,
          screen,
          viewport: vp,
          state: 'sidebar-sheet-open',
          trigger: toggle,
          dialog: page.getByRole('dialog', { name: 'Меню' }),
        })
      } else {
        await toggle.click()
        await expect(page.getByRole('navigation', { name: NAV_LABEL })).toBeVisible()
        await auditState(page, { screen, state: 'sidebar-collapsed', viewport: vp })
        await toggle.click()
        await auditState(page, { screen, state: 'sidebar-expanded', viewport: vp })
      }

      await auditMenu(page, vp, screen, 'profile-menu-open', profileButton(page))
      if (usesSidebarSheet(page)) {
        await expect(page.getByRole('button', { name: 'Сменить тему' })).toBeHidden()
      } else {
        await auditMenu(
          page,
          vp,
          screen,
          'theme-menu-open',
          page.getByRole('button', { name: 'Сменить тему' }),
        )
      }

      await auditDialog({
        page,
        screen,
        viewport: vp,
        state: 'sign-out-confirm',
        escape: false,
        trigger: profileButton(page),
        open: async () => {
          await profileButton(page).click()
          await page.getByRole('menuitem', { name: 'Выйти' }).click()
        },
        dialog: page.getByRole('alertdialog', { name: 'Выйти из аккаунта?' }),
      })
    })
  })
})

test.describe('layout: manager', () => {
  test('objects list: long data, pagination, empty filtered state, row menu and dialogs', async ({
    page,
  }) => {
    const m = await createUser('manager', LONG.userLabel)
    const a = await createUser('executor', LONG.userLabel)
    const token = uid()
    const name = longObjectName(token)
    const objectId = await createObject(m, name, LONG.address)
    await createTask(m, objectId, a, longTaskTitle(), LONG.description)
    const pagedToken = `Страничный ${uid()}`
    for (let i = 1; i <= 12; i++) {
      await createObject(m, `${pagedToken} ${String(i).padStart(2, '0')}`, `Адрес ${i}`)
    }
    await login(page, m)

    await forViewports(page, async (vp) => {
      const screen = 'objects-manager'
      await openObjectsFiltered(page, token)
      await expect(page.getByRole('link', { name })).toBeVisible()
      await auditState(page, { screen, state: 'list-long-data', viewport: vp })

      await auditMenu(page, vp, screen, 'row-menu-open', rowActions(page, name))

      await openObjectsFiltered(page, pagedToken)
      await expect(page.getByRole('status').filter({ hasText: 'Страница 1 из 2' })).toBeVisible()
      await auditState(page, { screen, state: 'pagination-page-1', viewport: vp })
      await page.getByRole('button', { name: 'Следующая страница' }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Страница 2 из 2' })).toBeVisible()
      await auditState(page, { screen, state: 'pagination-page-2', viewport: vp })

      await openObjectsFiltered(page, `нет-такого-${uid()}`)
      await expect(page.getByText('Ничего не найдено')).toBeVisible()
      await auditState(page, { screen, state: 'empty-filtered', viewport: vp })

      await openObjectsFiltered(page, token)
      await auditDialog({
        page,
        screen,
        viewport: vp,
        state: 'create-dialog',
        trigger: page.getByRole('button', { name: 'Добавить объект' }),
        dialog: page.getByRole('dialog', { name: 'Добавить объект' }),
        body: async (snap) => {
          const dialog = page.getByRole('dialog', { name: 'Добавить объект' })
          await dialog.getByRole('button', { name: 'Создать' }).click()
          await expect(dialog.getByText('Введите название')).toBeVisible()
          await snap('create-dialog-errors')
          await dialog.getByLabel('Название').fill(LONG.objectName)
          await dialog.getByLabel('Адрес').fill(LONG.address)
          await snap('create-dialog-long-values')
        },
      })

      await auditDialog({
        page,
        screen,
        viewport: vp,
        state: 'edit-dialog-long-values',
        trigger: rowActions(page, name),
        open: openRowItem(page, name, 'Редактировать'),
        dialog: page.getByRole('dialog', { name: 'Редактировать объект' }),
      })

      const deleteDialog = page.getByRole('alertdialog', { name: 'Удалить объект?' })
      await auditDialog({
        page,
        screen,
        viewport: vp,
        state: 'delete-dialog',
        escape: false,
        trigger: rowActions(page, name),
        open: openRowItem(page, name, 'Удалить'),
        dialog: deleteDialog,
        body: async (snap) => {
          await deleteDialog.getByRole('button', { name: 'Удалить', exact: true }).click()
          await expect(
            deleteDialog.getByText('Нельзя удалить объект, пока в нём есть активные задачи'),
          ).toBeVisible()
          await snap('delete-dialog-error-has-tasks')
        },
      })
    })
  })

  test('object page: long tasks, status filter, empty states and dialogs', async ({ page }) => {
    const m = await createUser('manager', LONG.userLabel)
    const a = await createUser('executor', LONG.userLabel)
    const b = await createUser('executor', 'b')
    const name = longObjectName()
    const objectId = await createObject(m, name, LONG.address)
    await createTask(m, objectId, a, longTaskTitle(), LONG.description)
    await createTask(m, objectId, b, `${LONG.word} ${uid()}`)
    const inProgress = await createTask(m, objectId, b, `В работе ${uid()}`)
    await move(b, inProgress, 'in_progress')
    const inReview = await createTask(m, objectId, b, `На проверке ${uid()}`)
    await move(b, inReview, 'in_progress')
    await move(b, inReview, 'in_review')
    const emptyId = await createObject(m, `Пустой ${uid()}`, 'Адрес')
    await login(page, m)

    await forViewports(page, async (vp) => {
      const screen = 'object-manager'
      await page.goto(`/objects/${emptyId}`)
      await expect(page.getByText('В объекте пока нет задач')).toBeVisible()
      const emptyHeading = await page.getByText('В объекте пока нет задач').boundingBox()
      const wrapper = await page.locator('[data-slot="table-container"]').first().boundingBox()
      expect(emptyHeading && wrapper, 'empty state and table wrapper are rendered').toBeTruthy()
      if (emptyHeading && wrapper) {
        expect(emptyHeading.x, `empty heading left @${vp.width}`).toBeGreaterThanOrEqual(
          wrapper.x - 0.5,
        )
        expect(
          emptyHeading.x + emptyHeading.width,
          `empty heading right @${vp.width}`,
        ).toBeLessThanOrEqual(wrapper.x + wrapper.width + 0.5)
      }
      await auditState(page, { screen: 'object-manager-empty', state: 'page', viewport: vp })

      await page.goto(`/objects/${objectId}`)
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
      await expect(page.getByRole('table', { name: 'Задачи объекта' })).toBeVisible()
      await auditState(page, { screen, state: 'with-long-tasks', viewport: vp })

      await auditMenu(page, vp, screen, 'status-filter-open', statusFilter(page))

      await page.goto(`/objects/${objectId}?status=accepted`)
      await expect(page.getByText('Ничего не найдено')).toBeVisible()
      await auditState(page, { screen, state: 'empty-filtered', viewport: vp })
      await page.goto(`/objects/${objectId}`)
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()

      await auditDialog({
        page,
        screen,
        viewport: vp,
        state: 'edit-object-dialog',
        trigger: page.getByRole('button', { name: 'Действия с объектом' }),
        open: openPageItem(page, 'Действия с объектом', 'Редактировать'),
        dialog: page.getByRole('dialog', { name: 'Редактировать объект' }),
      })

      const taskSheet = page.getByRole('dialog', { name: 'Новая задача' })
      await auditDialog({
        page,
        screen,
        viewport: vp,
        state: 'create-task-sheet',
        trigger: page.getByRole('button', { name: 'Добавить задачу' }),
        dialog: taskSheet,
        body: async (snap) => {
          await taskSheet.getByRole('button', { name: 'Создать' }).click()
          await expect(taskSheet.getByText('Введите название')).toBeVisible()
          await snap('create-task-sheet-errors')
          await taskSheet.getByLabel('Название').fill(LONG.taskTitle)
          await taskSheet.getByLabel('Описание').fill(LONG.description)
          await pickExecutor(taskSheet, page, a.fullName)
          await snap('create-task-sheet-long-values')
        },
      })

      const deleteDialog = page.getByRole('alertdialog', { name: 'Удалить объект?' })
      await auditDialog({
        page,
        screen,
        viewport: vp,
        state: 'delete-object-dialog',
        escape: false,
        trigger: page.getByRole('button', { name: 'Действия с объектом' }),
        open: openPageItem(page, 'Действия с объектом', 'Удалить'),
        dialog: deleteDialog,
        body: async (snap) => {
          await deleteDialog.getByRole('button', { name: 'Удалить', exact: true }).click()
          await expect(
            deleteDialog.getByText('Нельзя удалить объект, пока в нём есть активные задачи'),
          ).toBeVisible()
          await snap('delete-object-dialog-error-has-tasks')
        },
      })
    })
  })

  test('task page: new, with edit sheet and delete dialog (long data)', async ({ page }) => {
    const m = await createUser('manager', LONG.userLabel)
    const a = await createUser('executor', LONG.userLabel)
    const objectId = await createObject(m, longObjectName(), LONG.address)
    const title = longTaskTitle()
    const taskId = await createTask(m, objectId, a, title, LONG.description)
    await login(page, m)

    await forViewports(page, async (vp) => {
      const screen = 'task-new-manager'
      await page.goto(`/tasks/${taskId}`)
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
      await auditState(page, { screen, state: 'page', viewport: vp })

      await auditDialog({
        page,
        screen,
        viewport: vp,
        state: 'edit-task-sheet',
        trigger: page.getByRole('button', { name: 'Действия с задачей' }),
        open: openPageItem(page, 'Действия с задачей', 'Редактировать'),
        dialog: page.getByRole('dialog', { name: 'Редактирование задачи' }),
      })
      await auditDialog({
        page,
        screen,
        viewport: vp,
        state: 'delete-task-dialog',
        escape: false,
        trigger: page.getByRole('button', { name: 'Действия с задачей' }),
        open: openPageItem(page, 'Действия с задачей', 'Удалить'),
        dialog: page.getByRole('alertdialog', { name: 'Удалить задачу?' }),
      })
    })

    await signOut(page)
    await login(page, a)
    await forViewports(page, async (vp) => {
      await page.goto(`/tasks/${taskId}`)
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
      await auditState(page, { screen: 'task-new-executor', state: 'page', viewport: vp })
    })
  })

  for (const theme of ['light', 'dark'] as const) {
    test(`task page: mobile path menu (${theme})`, async ({ page }) => {
      const m = await createUser('manager', LONG.userLabel)
      const a = await createUser('executor', LONG.userLabel)
      const objectId = await createObject(m, longObjectName(), LONG.address)
      const title = longTaskTitle()
      const taskId = await createTask(m, objectId, a, title, LONG.description)
      if (theme === 'dark') await useDarkTheme(page)
      await login(page, m)

      for (const vp of VIEWPORTS.filter((v) => v.width < 768)) {
        await resize(page, vp)
        await page.goto(`/tasks/${taskId}`)
        await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
        const trigger = page.getByRole('button', { name: /показать путь/ })
        await trigger.click()
        const menu = page.getByRole('menu')
        await expect(menu).toBeVisible()
        await settleAnimations(page)

        const box = await menu.boundingBox()
        expect(box, 'path menu has a box').not.toBeNull()
        if (box) {
          expect(box.x, `menu left edge @ ${vp.width}`).toBeGreaterThanOrEqual(15)
          expect(box.x + box.width, `menu right edge @ ${vp.width}`).toBeLessThanOrEqual(
            vp.width - 15,
          )
          expect(box.width, `menu width @ ${vp.width}`).toBeGreaterThanOrEqual(vp.width - 40)
        }
        const items = menu.getByRole('menuitem')
        await expect(items).toHaveCount(3)
        for (const item of await items.all()) {
          const h = (await item.boundingBox())?.height ?? 0
          expect(h, `path row height @ ${vp.width}`).toBeGreaterThanOrEqual(44)
          expect(await item.locator('svg').count(), 'row has a leading icon').toBeGreaterThan(0)
        }
        const current = items.last()
        await expect(current).toHaveAttribute('aria-current', 'page')
        expect(await current.evaluate((el) => el.closest('a') !== null || el.tagName === 'A')).toBe(
          false,
        )
        await expect(menu.getByRole('menuitem').first()).toHaveAttribute('href', /\/objects/)
        const lefts = await Promise.all((await items.all()).map((i) => i.boundingBox()))
        expect(new Set(lefts.map((b) => Math.round(b?.x ?? 0))).size).toBe(1)

        await auditState(page, {
          screen: `task-path-menu-${theme}`,
          state: 'open',
          viewport: vp,
        })
        await page.keyboard.press('Escape')
        await expect(menu).toBeHidden()
        await expect(trigger).toBeFocused()
      }

      await page.keyboard.press('Enter')
      await expect(page.getByRole('menu')).toBeVisible()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/objects(\?.*)?$/)
    })
  }

  test('task page: in review with long rework history; rework note; rework dialog', async ({
    page,
  }) => {
    const m = await createUser('manager', LONG.userLabel)
    const a = await createUser('executor', LONG.userLabel)
    const objectId = await createObject(m, longObjectName(), LONG.address)
    const title = longTaskTitle()
    const taskId = await createTask(m, objectId, a, title, LONG.description)
    await move(a, taskId, 'in_progress')
    await move(a, taskId, 'in_review')
    await move(m, taskId, 'rework', LONG.comment)
    await move(a, taskId, 'in_progress')
    await move(a, taskId, 'in_review')

    const reworkTitle = longTaskTitle()
    const reworkId = await createTask(m, objectId, a, reworkTitle, LONG.description)
    await move(a, reworkId, 'in_progress')
    await move(a, reworkId, 'in_review')
    await move(m, reworkId, 'rework', LONG.comment)
    await login(page, m)

    await forViewports(page, async (vp) => {
      const screen = 'task-in-review-manager'
      await page.goto(`/tasks/${taskId}`)
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
      await expect(page.getByRole('heading', { level: 2, name: 'История' })).toBeVisible()
      await expect(page.getByRole('listitem').first()).toBeVisible()
      await auditState(page, { screen, state: 'page-with-history', viewport: vp })

      const dialog = page.getByRole('dialog', { name: 'Вернуть на доработку' })
      await auditDialog({
        page,
        screen,
        viewport: vp,
        state: 'rework-dialog',
        trigger: page.getByRole('button', { name: 'Вернуть на доработку' }),
        dialog,
        body: async (snap) => {
          await dialog.getByRole('button', { name: 'Вернуть на доработку' }).click()
          await expect(dialog.getByText('Укажите комментарий')).toBeVisible()
          await snap('rework-dialog-empty-error')
          await dialog.getByLabel('Комментарий').fill(LONG.comment)
          await snap('rework-dialog-long-comment')
        },
      })

      await page.goto(`/tasks/${reworkId}`)
      await expect(page.getByRole('note', { name: 'Замечание постановщика' })).toBeVisible()
      await auditState(page, { screen: 'task-rework-manager', state: 'rework-note', viewport: vp })
    })

    await signOut(page)
    await login(page, a)
    await forViewports(page, async (vp) => {
      await page.goto(`/tasks/${taskId}`)
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
      await auditState(page, { screen: 'task-in-review-executor', state: 'page', viewport: vp })
      await page.goto(`/tasks/${reworkId}`)
      await expect(page.getByRole('note', { name: 'Замечание постановщика' })).toBeVisible()
      await auditState(page, { screen: 'task-rework-executor', state: 'rework-note', viewport: vp })
    })
  })

  test('task page: accepted', async ({ page }) => {
    const m = await createUser('manager', 'm')
    const a = await createUser('executor', LONG.userLabel)
    const objectId = await createObject(m, `Объект ${uid()}`, 'Адрес')
    const title = longTaskTitle()
    const taskId = await createTask(m, objectId, a, title, LONG.description)
    await move(a, taskId, 'in_progress')
    await move(a, taskId, 'in_review')
    await move(m, taskId, 'rework', LONG.comment)
    await move(a, taskId, 'in_progress')
    await move(a, taskId, 'in_review')
    await move(m, taskId, 'accepted')
    await login(page, m)

    await forViewports(page, async (vp) => {
      await page.goto(`/tasks/${taskId}`)
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
      await expect(page.getByText('Принята', { exact: true }).first()).toBeVisible()
      await auditState(page, { screen: 'task-accepted-manager', state: 'page', viewport: vp })
    })
  })

  test('not-found states', async ({ page }) => {
    const m = await createUser('manager', 'm')
    await login(page, m)
    const missing = crypto.randomUUID()
    const cases = [
      { screen: 'not-found-route', path: `/nothing-${uid()}`, heading: 'Страница не найдена' },
      {
        screen: 'not-found-object',
        path: `/objects/${missing}`,
        heading: 'Объект не найден или недоступен',
      },
      {
        screen: 'not-found-task',
        path: `/tasks/${missing}`,
        heading: 'Задача не найдена или недоступна',
      },
    ]
    await forViewports(page, async (vp) => {
      for (const c of cases) {
        await page.goto(c.path)
        await expect(page.getByRole('heading', { level: 1, name: c.heading })).toBeVisible()
        await auditState(page, { screen: c.screen, state: 'page', viewport: vp })
      }
    })
  })
})

test.describe('layout: executor', () => {
  test('my tasks: table with long data, status filter, pagination, empty filtered', async ({
    page,
  }) => {
    const m = await createUser('manager', 'm')
    const a = await createUser('executor', LONG.userLabel)
    const objectId = await createObject(m, longObjectName(), LONG.address)
    const mk = (title: string) => createTask(m, objectId, a, title, LONG.description)

    await mk(longTaskTitle())
    await mk(`${LONG.word} ${uid()}`)
    const inProgress = await mk(`В работе ${uid()}`)
    await move(a, inProgress, 'in_progress')
    const inReview = await mk(`На проверке ${uid()}`)
    await move(a, inReview, 'in_progress')
    await move(a, inReview, 'in_review')
    const rework = await mk(`На доработке ${uid()}`)
    await move(a, rework, 'in_progress')
    await move(a, rework, 'in_review')
    await move(m, rework, 'rework', LONG.comment)
    const accepted = await mk(`Принята ${uid()}`)
    await move(a, accepted, 'in_progress')
    await move(a, accepted, 'in_review')
    await move(m, accepted, 'accepted')
    for (let i = 1; i <= 6; i++) await mk(`Дополнительная ${uid()} ${i}`)
    await login(page, a)

    await forViewports(page, async (vp) => {
      const screen = 'my-tasks'
      await page.goto('/my-tasks')
      await expect(page.getByRole('table', { name: 'Мои задачи' })).toBeVisible()
      await expect(page.getByRole('status').filter({ hasText: 'Страница 1 из 2' })).toBeVisible()
      await auditState(page, { screen, state: 'table-long-data', viewport: vp })

      await auditMenu(page, vp, screen, 'status-filter-open', statusFilter(page))
      await statusFilter(page).click()
      await page.getByRole('menuitemcheckbox', { name: /Принята/ }).click()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('button', { name: /^Статус: выбрано 1/ })).toBeVisible()
      await auditState(page, { screen, state: 'status-filtered', viewport: vp })

      await page.goto('/my-tasks?page=2')
      await expect(page.getByRole('status').filter({ hasText: 'Страница 2 из 2' })).toBeVisible()
      await auditState(page, { screen, state: 'pagination-page-2', viewport: vp })

      await page.goto(`/my-tasks?q=нет-такого-${uid()}`)
      await expect(page.getByText('Ничего не найдено')).toBeVisible()
      await auditState(page, { screen, state: 'empty-filtered', viewport: vp })

      await page.goto('/objects')
      await expect(page.getByRole('heading', { level: 1, name: 'Объекты' })).toBeVisible()
      await expect(page.getByRole('link', { name: LONG.word, exact: false })).toBeVisible()
      await auditState(page, { screen: 'objects-executor', state: 'list-long-data', viewport: vp })
    })
  })

  test('my tasks and objects: empty states', async ({ page }) => {
    const a = await createUser('executor', 'empty')
    await login(page, a)
    await forViewports(page, async (vp) => {
      await page.goto('/my-tasks')
      await expect(page.getByText('Вам пока не назначено задач')).toBeVisible()
      await auditState(page, { screen: 'my-tasks-empty', state: 'page', viewport: vp })
      await page.goto('/objects')
      await expect(page.getByText('У вас пока нет объектов с задачами')).toBeVisible()
      await auditState(page, { screen: 'objects-executor-empty', state: 'page', viewport: vp })
    })
  })
})

test.describe('layout: dark theme', () => {
  test('objects list and task page in dark theme (long data, menu, sheet, rework note)', async ({
    page,
  }) => {
    await useDarkTheme(page)
    const m = await createUser('manager', LONG.userLabel)
    const a = await createUser('executor', LONG.userLabel)
    const token = uid()
    const name = longObjectName(token)
    const objectId = await createObject(m, name, LONG.address)
    const taskId = await createTask(m, objectId, a, longTaskTitle(), LONG.description)
    await move(a, taskId, 'in_progress')
    await move(a, taskId, 'in_review')
    await move(m, taskId, 'rework', LONG.comment)
    await login(page, m)
    await expect(page.locator('html')).toHaveClass(/dark/)

    await forViewports(page, async (vp) => {
      await openObjectsFiltered(page, token)
      await expect(page.getByRole('link', { name })).toBeVisible()
      await auditState(page, { screen: 'dark-objects', state: 'list', viewport: vp })
      await auditMenu(page, vp, 'dark-objects', 'row-menu-open', rowActions(page, name))

      await page.goto(`/objects/${objectId}`)
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
      await auditState(page, { screen: 'dark-object', state: 'page', viewport: vp })

      await page.goto(`/tasks/${taskId}`)
      await expect(page.getByRole('note', { name: 'Замечание постановщика' })).toBeVisible()
      await auditState(page, { screen: 'dark-task', state: 'rework-note', viewport: vp })
      await auditDialog({
        page,
        screen: 'dark-task',
        viewport: vp,
        state: 'edit-task-sheet',
        trigger: page.getByRole('button', { name: 'Действия с задачей' }),
        open: openPageItem(page, 'Действия с задачей', 'Редактировать'),
        dialog: page.getByRole('dialog', { name: 'Редактирование задачи' }),
      })
    })
  })
})

test.describe('layout: notifications (bell popover and toasts)', () => {
  test.use({ liveUpdates: true })

  test('popover with long titles and a toast stay inside the viewport and off the sticky header', async ({
    page,
  }) => {
    const [m, a] = await Promise.all([
      createUser('manager', LONG.userLabel),
      createUser('executor', LONG.userLabel),
    ])
    const objectId = await createObject(m, longObjectName(), LONG.address)
    const taskId = await createTask(m, objectId, a, longTaskTitle(), LONG.description)
    await move(a, taskId, 'in_progress')
    await createTask(m, objectId, a, longTaskTitle())
    await createTask(m, objectId, a, longTaskTitle())
    const rt = watchRealtime(page)
    await login(page, a)
    await rt.ready(a)

    for (const vp of [VIEWPORTS[0], VIEWPORTS[1], VIEWPORTS[3]]) {
      await resize(page, vp)
      await expect(page.getByRole('heading', { level: 1, name: 'Мои задачи' })).toBeVisible()

      await bell(page).click()
      await expect(bellPopover(page)).toBeVisible()
      await expect(bellPopover(page).getByRole('listitem').first()).toBeVisible()
      const box = await bellPopover(page).boundingBox()
      expect(box, 'popover is rendered').not.toBeNull()
      const gutter = vp.width < 768 ? 15.5 : 0
      expect(box?.x ?? -1, `popover left gap @${vp.width}`).toBeGreaterThanOrEqual(gutter)
      expect(
        vp.width - ((box?.x ?? 0) + (box?.width ?? 0)),
        `popover right gap @${vp.width}`,
      ).toBeGreaterThanOrEqual(gutter)
      expect(
        (box?.y ?? 0) + (box?.height ?? 0),
        `popover bottom edge @${vp.width}`,
      ).toBeLessThanOrEqual(vp.height)
      await auditState(page, { screen: 'bell-popover', state: 'long-titles', viewport: vp })
      await page.keyboard.press('Escape')
      await expect(bellPopover(page)).toBeHidden()

      const title = longTaskTitle()
      await createTask(m, objectId, a, title)
      const toast = toastWith(page, title.slice(0, 20))
      await expect(toast.first()).toBeVisible({ timeout: 15_000 })
      await settleAnimations(page)
      const header = await page.getByRole('banner').boundingBox()
      const toastBox = await toast.first().boundingBox()
      expect(header && toastBox, 'header and toast are rendered').toBeTruthy()
      if (header && toastBox) {
        expect(toastBox.y, `toast is below the header @${vp.width}`).toBeGreaterThanOrEqual(
          header.y + header.height,
        )
        expect(toastBox.x, `toast left edge @${vp.width}`).toBeGreaterThanOrEqual(0)
        expect(toastBox.x + toastBox.width, `toast right edge @${vp.width}`).toBeLessThanOrEqual(
          vp.width,
        )
      }
      const closeBox = await toast
        .first()
        .getByRole('button', { name: 'Закрыть уведомление' })
        .boundingBox()
      const actionBox = await toast.first().getByRole('button', { name: 'Открыть' }).boundingBox()
      expect(closeBox && actionBox, 'close and action buttons are rendered').toBeTruthy()
      if (closeBox && actionBox) {
        const hit = 10
        const apart =
          closeBox.x + closeBox.width + hit <= actionBox.x ||
          actionBox.x + actionBox.width <= closeBox.x - hit ||
          closeBox.y + closeBox.height + hit <= actionBox.y ||
          actionBox.y + actionBox.height <= closeBox.y - hit
        expect(apart, `close button overlaps the action button @${vp.width}`).toBe(true)
        expect(closeBox.width, `close circle is small @${vp.width}`).toBeLessThanOrEqual(26)
      }
      await auditState(page, {
        screen: 'toast',
        state: 'long-title',
        viewport: vp,
        allowToastOverlay: true,
      })
      await page.keyboard.press('Alt+T')
      await toast.first().getByRole('button', { name: 'Закрыть уведомление' }).click()
    }
  })
})

test.describe('layout: board', () => {
  async function longBoard() {
    const m = await createUser('manager', LONG.userLabel)
    const a = await createUser('executor', LONG.userLabel)
    const objectName = longObjectName()
    const objectId = await createObject(m, objectName, LONG.address)
    const titles: string[] = []
    for (const to of [null, 'in_progress', 'in_review'] as const) {
      const title = longTaskTitle()
      const taskId = await createTask(m, objectId, a, title)
      if (to) await move(a, taskId, 'in_progress')
      if (to === 'in_review') await move(a, taskId, 'in_review')
      titles.push(title)
    }
    return { m, a, objectId, objectName, titles }
  }

  async function showColumn(page: Page, name: string): Promise<void> {
    const tab = page.getByRole('tab', { name: new RegExp(`^${name}`) })
    if ((await tab.count()) > 0) await tab.click()
  }

  async function auditBoard(page: Page, screen: string, objectId: string, titles: string[]) {
    await forViewports(page, async (vp) => {
      await page.goto(`/board?object=${objectId}`)
      await expect(
        page.getByRole('heading', { level: 1, name: 'Доска задач', exact: true }),
      ).toBeVisible()
      await showColumn(page, 'На проверке')
      const link = page.getByRole('link', { name: titles[2] ?? '', exact: true })
      await expect(link).toBeVisible()
      await expect(link, 'clamped title keeps the full text').toHaveAttribute(
        'title',
        titles[2] ?? '',
      )
      await auditState(page, { screen, state: 'long-data', viewport: vp })

      await page.goto('/board')
      await expect(
        page.getByRole('heading', { level: 1, name: 'Доска задач', exact: true }),
      ).toBeVisible()
      await showColumn(page, 'На проверке')
      await expect(page.getByRole('link', { name: titles[2] ?? '', exact: true })).toBeVisible()
      await auditState(page, { screen, state: 'long-data-all-objects', viewport: vp })

      await page.getByRole('link', { name: titles[2] ?? '', exact: true }).waitFor()
      const card = page
        .getByRole('article')
        .filter({ has: page.getByRole('link', { name: titles[2] ?? '', exact: true }) })
      await card.getByRole('button', { name: 'Вернуть на доработку' }).click()
      const dialog = page.getByRole('dialog', { name: 'Вернуть на доработку' })
      await expect(dialog).toBeVisible()
      await expectFocusInside(dialog, `${screen} comment dialog @ ${String(vp.width)}`)
      await dialog.getByLabel('Комментарий').fill(LONG.comment)
      await auditState(page, { screen, state: 'comment-dialog', viewport: vp })
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    })
  }

  test('manager board with long data in the light theme (columns and tabs, comment dialog)', async ({
    page,
  }) => {
    const { m, objectId, titles } = await longBoard()
    await login(page, m)
    await auditBoard(page, 'board-manager', objectId, titles)
  })

  test('manager board with long data in the dark theme', async ({ page }) => {
    await useDarkTheme(page)
    const { m, objectId, titles } = await longBoard()
    await login(page, m)
    await expect(page.locator('html')).toHaveClass(/dark/)
    await auditBoard(page, 'board-manager-dark', objectId, titles)
  })

  test('executor board with long data and a not-found object', async ({ page }) => {
    const { a, objectId, titles } = await longBoard()
    await login(page, a)
    await forViewports(page, async (vp) => {
      await page.goto(`/board?object=${objectId}`)
      await expect(
        page.getByRole('heading', { level: 1, name: 'Доска задач', exact: true }),
      ).toBeVisible()
      await showColumn(page, 'В работе')
      await expect(page.getByRole('link', { name: titles[1] ?? '', exact: true })).toBeVisible()
      await auditState(page, { screen: 'board-executor', state: 'long-data', viewport: vp })

      await page.goto(`/board?object=${crypto.randomUUID()}`)
      await expect(page.getByText('Объект не найден или недоступен')).toBeVisible()
      await auditState(page, { screen: 'board-executor', state: 'object-not-found', viewport: vp })
    })
  })

  test('executor: empty board', async ({ page }) => {
    const lonely = await createUser('executor', 'lonely')
    await login(page, lonely)
    await forViewports(page, async (vp) => {
      await page.goto('/board')
      await expect(page.getByText('Вам пока не назначили задачи')).toBeVisible()
      await auditState(page, { screen: 'board-executor', state: 'empty', viewport: vp })
    })
  })

  test('manager: an object without tasks offers to reset the filter', async ({ page }) => {
    const m = await createUser('manager', 'empty')
    const objectId = await createObject(m, `Пустой ${uid()}`)
    await login(page, m)
    await forViewports(page, async (vp) => {
      await page.goto(`/board?object=${objectId}`)
      await expect(page.getByText('В объекте нет задач')).toBeVisible()
      await expect(
        page
          .getByRole('button', { name: 'Сбросить фильтр' })
          .or(page.getByRole('link', { name: 'Сбросить фильтр' })),
      ).toBeVisible()
      await auditState(page, { screen: 'board-manager', state: 'empty-object', viewport: vp })
    })
  })
})

test.describe('layout: board object filter popover', () => {
  test('long object names: bounded width, native scroll, no overflow at every width', async ({
    page,
  }) => {
    const m = await createUser('manager', LONG.userLabel)
    const token = uid()
    const name = longObjectName(token)
    await createObject(m, name, LONG.address)
    await createObject(m, `${token}-короткий`, 'Адрес')
    await login(page, m)

    await forViewports(page, async (vp) => {
      await page.goto('/board')
      await expect(page.getByRole('heading', { level: 1, name: 'Доска задач' })).toBeVisible()
      const trigger = page.getByRole('combobox', { name: /Объект/ })
      await trigger.click()
      const search = page.getByRole('combobox', { name: 'Поиск по названию или адресу' })
      await search.fill(token)
      const options = page.getByRole('option', { name: new RegExp(token) })
      await expect(options).toHaveCount(2)
      const popover = page.getByRole('dialog').filter({ has: search })
      const box = await popover.boundingBox()
      expect(box?.x ?? -1, `popover left @ ${String(vp.width)}`).toBeGreaterThanOrEqual(0)
      expect((box?.x ?? 0) + (box?.width ?? 0), 'popover right edge').toBeLessThanOrEqual(
        vp.width + 0.5,
      )
      await expect(popover.getByRole('button'), 'native scroll: no arrow buttons').toHaveCount(0)
      const overflowY = await page
        .getByRole('listbox')
        .evaluate((el) => getComputedStyle(el).overflowY)
      expect(['auto', 'scroll']).toContain(overflowY)
      await auditState(page, { screen: 'board-filter', state: 'popover-long', viewport: vp })

      await options.first().click()
      await page.keyboard.press('Escape')
      await expect(popover).toBeHidden()
      await auditState(page, { screen: 'board-filter', state: 'chip-long', viewport: vp })
    })
  })
})
