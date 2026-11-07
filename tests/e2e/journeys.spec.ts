import {
  createObject,
  createTask,
  createUser,
  expect,
  expectNoA11yViolations,
  login,
  test,
} from './fixtures'
import {
  goToSection,
  headerStatus,
  newUserPage,
  openObjectsFiltered,
  profileButton,
  rowWithLink,
  signOut,
} from './app-helpers'
import type { Database } from '../../src/shared/api/database.types'

type TaskStatus = Database['public']['Enums']['task_status']

const unique = (prefix: string) => `${prefix} ${crypto.randomUUID().slice(0, 8)}`

test.describe('manager creates work', () => {
  test('M creates an object and a task for A; the task is «Новая»', async ({ page }) => {
    // Create, check, sign in as A: ~34 s under a full parallel run (measured 2026-11-07).
    test.slow()
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const objectName = unique('Объект')
    const taskTitle = unique('Задача')

    await login(page, m)
    await expect(page.getByRole('heading', { level: 1, name: 'Объекты' })).toBeVisible()
    await expectNoA11yViolations(page)

    await page.getByRole('button', { name: 'Добавить объект' }).click()
    const objectDialog = page.getByRole('dialog', { name: 'Добавить объект' })
    await expectNoA11yViolations(page)
    await objectDialog.getByLabel('Название').fill(objectName)
    await objectDialog.getByLabel('Адрес').fill('ул. Тестовая, 1')
    await objectDialog.getByRole('button', { name: 'Создать' }).click()
    await expect(objectDialog).toBeHidden()

    // The list is shared and paged (10 per page): find the new object by search before opening it.
    await page.getByRole('searchbox', { name: 'Поиск по названию и адресу' }).fill(objectName)
    await page.getByRole('link', { name: objectName }).click()
    await expect(page.getByRole('heading', { level: 1, name: objectName })).toBeVisible()
    await expect(page.getByText('В объекте пока нет задач')).toBeVisible()
    await expectNoA11yViolations(page)

    await page.getByRole('button', { name: 'Добавить задачу' }).click()
    const taskSheet = page.getByRole('dialog', { name: 'Новая задача' })
    await taskSheet.getByLabel('Название').fill(taskTitle)
    await taskSheet.getByLabel('Описание').fill('Описание задачи')
    await taskSheet.getByRole('combobox', { name: 'Исполнитель' }).click()
    await page.getByRole('option', { name: a.fullName }).click()
    await expectNoA11yViolations(page)
    await taskSheet.getByRole('button', { name: 'Создать' }).click()
    await expect(taskSheet).toBeHidden()

    await expect(page.getByRole('table', { name: 'Задачи объекта' })).toBeVisible()
    await expect(rowWithLink(page, taskTitle).getByText('Новая', { exact: true })).toBeVisible()

    await page.getByRole('link', { name: taskTitle }).click()
    await expect(page.getByRole('heading', { level: 1, name: taskTitle })).toBeVisible()
    await expect(headerStatus(page, 'Новая')).toBeVisible()
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Задача создана' }).getByText('Новая'),
    ).toBeVisible()
    await expectNoA11yViolations(page)
  })
})

test.describe('manager manages objects and tasks', () => {
  test('M edits the object and the task, reassigns A to B, deletes the task, then the empty object', async ({
    browser,
    page,
  }) => {
    // Three users, three sign-ins and a dozen screens: ~21 s alone, longer under a parallel run.
    test.slow()
    const [m, a, b] = await Promise.all([
      createUser('manager', 'm'),
      createUser('executor', 'a'),
      createUser('executor', 'b'),
    ])
    const token = crypto.randomUUID().slice(0, 8)
    const objectName = `Объект ${token}`
    const renamed = `Объект ${token} изменён`
    const taskTitle = `Задача ${token}`
    const editedTitle = `Задача ${token} правка`
    const objectId = await createObject(m, objectName, 'Адрес до')
    const taskId = await createTask(m, objectId, a, taskTitle, 'Описание до')

    // 1. Edit the object from the row menu of the list.
    await login(page, m)
    await openObjectsFiltered(page, token)
    await page.getByRole('button', { name: `Действия с объектом «${objectName}»` }).click()
    await expectNoA11yViolations(page)
    await page.getByRole('menuitem', { name: 'Редактировать' }).click()
    const objectDialog = page.getByRole('dialog', { name: 'Редактировать объект' })
    await expect(objectDialog.getByLabel('Название')).toHaveValue(objectName)
    await expect(objectDialog.getByLabel('Адрес')).toHaveValue('Адрес до')
    await expectNoA11yViolations(page)
    await objectDialog.getByLabel('Название').fill(renamed)
    await objectDialog.getByLabel('Адрес').fill('Адрес после')
    await objectDialog.getByRole('button', { name: 'Сохранить' }).click()
    await expect(objectDialog).toBeHidden()
    await page.getByRole('link', { name: renamed, exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: renamed })).toBeVisible()
    await expect(page.getByText('Адрес после')).toBeVisible()
    await expectNoA11yViolations(page)

    // 2. Edit the task (title and description), then reassign it A -> B.
    await page.getByRole('link', { name: taskTitle, exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: taskTitle })).toBeVisible()
    await page.getByRole('button', { name: 'Действия с задачей' }).click()
    await page.getByRole('menuitem', { name: 'Редактировать' }).click()
    const taskSheet = page.getByRole('dialog', { name: 'Редактирование задачи' })
    await expect(taskSheet.getByLabel('Название')).toHaveValue(taskTitle)
    await expect(taskSheet.getByLabel('Описание')).toHaveValue('Описание до')
    await expectNoA11yViolations(page)
    await taskSheet.getByLabel('Название').fill(editedTitle)
    await taskSheet.getByLabel('Описание').fill('Описание после')
    await taskSheet.getByRole('button', { name: 'Сохранить' }).click()
    await expect(taskSheet).toBeHidden()
    await expect(page.getByRole('heading', { level: 1, name: editedTitle })).toBeVisible()
    await expect(page.getByText('Описание после')).toBeVisible()
    await expect(page.getByText(a.fullName, { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Действия с задачей' }).click()
    await page.getByRole('menuitem', { name: 'Редактировать' }).click()
    await taskSheet.getByRole('combobox', { name: 'Исполнитель' }).click()
    await page.getByRole('option', { name: b.fullName }).click()
    await taskSheet.getByRole('button', { name: 'Сохранить' }).click()
    await expect(taskSheet).toBeHidden()
    await expect(page.getByText(b.fullName, { exact: true })).toBeVisible()
    await expect(page.getByText(a.fullName, { exact: true })).toHaveCount(0)
    await expectNoA11yViolations(page)

    // 3. A lost the task, B sees it in «Мои задачи».
    const pageA = await newUserPage(browser)
    await login(pageA, a)
    await expect(pageA.getByText('Вам пока не назначено задач')).toBeVisible()
    await expect(pageA.getByRole('link', { name: editedTitle })).toHaveCount(0)
    await pageA.goto(`/tasks/${taskId}`)
    await expect(
      pageA.getByRole('heading', { level: 1, name: 'Задача не найдена или недоступна' }),
    ).toBeVisible()
    await pageA.goto(`/objects/${objectId}`)
    await expect(
      pageA.getByRole('heading', { level: 1, name: 'Объект не найден или недоступен' }),
    ).toBeVisible()

    const pageB = await newUserPage(browser)
    await login(pageB, b)
    await expect(pageB.getByRole('heading', { level: 1, name: 'Мои задачи' })).toBeVisible()
    await expect(pageB.getByRole('link', { name: editedTitle, exact: true })).toBeVisible()
    await expectNoA11yViolations(pageB)
    await pageB.getByRole('link', { name: editedTitle, exact: true }).click()
    await expect(pageB.getByRole('heading', { level: 1, name: editedTitle })).toBeVisible()
    await expect(pageB.getByRole('button', { name: 'Взять в работу' })).toBeVisible()

    // 4. The object with an active task cannot be deleted; the error is shown inside the dialog.
    // The page is on the task: the object is linked both from the breadcrumbs and from the details.
    await page.getByRole('main').getByRole('link', { name: renamed, exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: renamed })).toBeVisible()
    await page.getByRole('button', { name: 'Действия с объектом' }).click()
    await page.getByRole('menuitem', { name: 'Удалить' }).click()
    const objectConfirm = page.getByRole('alertdialog', { name: 'Удалить объект?' })
    await objectConfirm.getByRole('button', { name: 'Удалить', exact: true }).click()
    await expect(
      objectConfirm.getByText('Нельзя удалить объект, пока в нём есть активные задачи'),
    ).toBeVisible()
    await expectNoA11yViolations(page)
    await objectConfirm.getByRole('button', { name: 'Отмена' }).click()
    await expect(objectConfirm).toBeHidden()

    // 5. Delete the task (soft): it leaves the object page and both executors' views.
    await page.getByRole('link', { name: editedTitle, exact: true }).click()
    await page.getByRole('button', { name: 'Действия с задачей' }).click()
    await page.getByRole('menuitem', { name: 'Удалить' }).click()
    const taskConfirm = page.getByRole('alertdialog', { name: 'Удалить задачу?' })
    await expectNoA11yViolations(page)
    await taskConfirm.getByRole('button', { name: 'Удалить', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/objects/${objectId}$`))
    await expect(page.getByText('В объекте пока нет задач')).toBeVisible()
    await page.goto(`/tasks/${taskId}`)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Задача не найдена или недоступна' }),
    ).toBeVisible()

    await pageB.goto('/my-tasks')
    await expect(pageB.getByText('Вам пока не назначено задач')).toBeVisible()
    await pageB.goto(`/tasks/${taskId}`)
    await expect(
      pageB.getByRole('heading', { level: 1, name: 'Задача не найдена или недоступна' }),
    ).toBeVisible()
    await pageA.goto('/my-tasks')
    await expect(pageA.getByText('Вам пока не назначено задач')).toBeVisible()

    // 6. Now the object is empty and can be deleted.
    await page.goto(`/objects/${objectId}`)
    await page.getByRole('button', { name: 'Действия с объектом' }).click()
    await page.getByRole('menuitem', { name: 'Удалить' }).click()
    await expectNoA11yViolations(page)
    await page
      .getByRole('alertdialog', { name: 'Удалить объект?' })
      .getByRole('button', { name: 'Удалить', exact: true })
      .click()
    await expect(page).toHaveURL(/\/objects$/)
    await page.getByRole('searchbox', { name: 'Поиск по названию и адресу' }).fill(token)
    await expect(page.getByText('Ничего не найдено')).toBeVisible()
    await page.goto(`/objects/${objectId}`)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Объект не найден или недоступен' }),
    ).toBeVisible()
    await expectNoA11yViolations(page)
  })

  test('hidden manage controls are also refused by the API for an executor', async () => {
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const objectId = await createObject(m, unique('Объект'))
    const taskId = await createTask(m, objectId, a, unique('Задача'))

    const deleteTask = await a.client.rpc('delete_task', { p_task_id: taskId })
    expect(deleteTask.error, 'executor must not delete a task').not.toBeNull()
    const deleteObject = await a.client.rpc('delete_object', { p_object_id: objectId })
    expect(deleteObject.error, 'executor must not delete an object').not.toBeNull()
    await a.client.from('objects').update({ name: 'Взлом' }).eq('id', objectId)

    const task = await m.client.from('tasks').select('id').eq('id', taskId)
    expect(task.data).toHaveLength(1)
    const object = await m.client.from('objects').select('name').eq('id', objectId)
    expect(object.data).toHaveLength(1)
    expect(object.data?.[0]?.name).not.toBe('Взлом')
  })
})

test.describe('executor works on a task', () => {
  test('A takes the task, sends it for review and sees no manager controls', async ({ page }) => {
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const objectName = unique('Объект')
    const title = unique('Задача')
    const objectId = await createObject(m, objectName)
    const taskId = await createTask(m, objectId, a, title)

    await login(page, a)
    await expect(page).toHaveURL(/\/my-tasks$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Мои задачи' })).toBeVisible()
    await expectNoA11yViolations(page)

    // The executor sees the object in the list without any manager controls.
    await goToSection(page, 'Объекты')
    await expect(page.getByRole('link', { name: objectName })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Добавить объект' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Действия с объектом/ })).toHaveCount(0)
    await expect(page.getByRole('columnheader', { name: 'Действия' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Удалить/ })).toHaveCount(0)
    await expectNoA11yViolations(page)

    await goToSection(page, 'Мои задачи')
    await expect(page.getByRole('table', { name: 'Мои задачи' })).toBeVisible()
    await page.getByRole('link', { name: title }).click()
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`))
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()

    await expect(page.getByRole('button', { name: 'Действия с задачей' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Принять' })).toHaveCount(0)
    await expectNoA11yViolations(page)

    await page.getByRole('button', { name: 'Взять в работу' }).click()
    await expect(headerStatus(page, 'В работе')).toBeVisible()
    await page.getByRole('button', { name: 'Отправить на проверку' }).click()
    await expect(headerStatus(page, 'На проверке')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Взять в работу' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Отправить на проверку' })).toHaveCount(0)
    await expectNoA11yViolations(page)

    await goToSection(page, 'Объекты')
    await page.getByRole('link', { name: objectName }).click()
    await expect(page.getByRole('heading', { level: 1, name: objectName })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Добавить задачу' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Действия с объектом' })).toHaveCount(0)
    await expectNoA11yViolations(page)
  })
})

test.describe('review cycle', () => {
  test('M returns for rework with a comment, A resubmits, M accepts', async ({ browser }) => {
    // Two users take turns over several sign-ins; under a parallel run it outgrows 30 s.
    test.slow()
    const [m, a] = await Promise.all([createUser('manager', 'm'), createUser('executor', 'a')])
    const title = unique('Задача')
    const objectId = await createObject(m, unique('Объект'))
    const taskId = await createTask(m, objectId, a, title)
    // Move the task to review through the API; the UI journey below starts from there.
    const steps: TaskStatus[] = ['in_progress', 'in_review']
    for (const to of steps) {
      const { error } = await a.client.rpc('change_task_status', {
        p_task_id: taskId,
        p_to_status: to,
      })
      if (error) throw error
    }
    const comment = unique('Нужны правки')

    const managerPage = await newUserPage(browser)
    await login(managerPage, m)
    await managerPage.goto(`/tasks/${taskId}`)
    await expect(managerPage.getByRole('heading', { level: 1, name: title })).toBeVisible()

    await managerPage.getByRole('button', { name: 'Вернуть на доработку' }).click()
    const dialog = managerPage.getByRole('dialog', { name: 'Вернуть на доработку' })
    await expectNoA11yViolations(managerPage)
    await dialog.getByRole('button', { name: 'Вернуть на доработку' }).click()
    await expect(dialog.getByText('Укажите комментарий')).toBeVisible()
    await expect(dialog).toBeVisible()

    await dialog.getByLabel('Комментарий').fill(comment)
    await dialog.getByRole('button', { name: 'Вернуть на доработку' }).click()
    await expect(dialog).toBeHidden()
    await expect(headerStatus(managerPage, 'На доработке')).toBeVisible()
    const note = managerPage.getByRole('note', { name: 'Замечание постановщика' })
    await expect(note).toContainText(comment)
    await expect(managerPage.getByRole('listitem').filter({ hasText: comment })).toBeVisible()
    await expectNoA11yViolations(managerPage)

    const executorPage = await newUserPage(browser)
    await login(executorPage, a)
    await executorPage.goto(`/tasks/${taskId}`)
    await expect(executorPage.getByRole('note', { name: 'Замечание постановщика' })).toContainText(
      comment,
    )
    await expectNoA11yViolations(executorPage)
    await executorPage.getByRole('button', { name: 'Взять в работу' }).click()
    await expect(headerStatus(executorPage, 'В работе')).toBeVisible()
    await expect(executorPage.getByRole('note', { name: 'Замечание постановщика' })).toHaveCount(0)
    await executorPage.getByRole('button', { name: 'Отправить на проверку' }).click()
    await expect(headerStatus(executorPage, 'На проверке')).toBeVisible()

    await managerPage.reload()
    await managerPage.getByRole('button', { name: 'Принять', exact: true }).click()
    await expect(headerStatus(managerPage, 'Принята')).toBeVisible()
    await expect(managerPage.getByRole('button', { name: 'Принять', exact: true })).toHaveCount(0)
    await expect(managerPage.getByRole('button', { name: 'Вернуть на доработку' })).toHaveCount(0)
    // An accepted task is not editable: the menu keeps only «Удалить».
    await managerPage.getByRole('button', { name: 'Действия с задачей' }).click()
    await expect(managerPage.getByRole('menuitem', { name: 'Удалить' })).toBeVisible()
    await expect(managerPage.getByRole('menuitem', { name: 'Редактировать' })).toHaveCount(0)
    await managerPage.keyboard.press('Escape')
    await expectNoA11yViolations(managerPage)
  })
})

test.describe('isolation between users', () => {
  test('B does not see the object/task of A and cannot open them by URL', async ({ page }) => {
    const [m, a, b] = await Promise.all([
      createUser('manager', 'm'),
      createUser('executor', 'a'),
      createUser('executor', 'b'),
    ])
    const objectName = unique('Объект')
    const title = unique('Задача')
    const objectId = await createObject(m, objectName)
    const taskId = await createTask(m, objectId, a, title)

    await login(page, b)
    await expect(page.getByText('Вам пока не назначено задач')).toBeVisible()
    await expect(page.getByRole('link', { name: title })).toHaveCount(0)
    await goToSection(page, 'Объекты')
    await expect(page.getByText('У вас пока нет объектов с задачами')).toBeVisible()
    await expect(page.getByRole('link', { name: objectName })).toHaveCount(0)
    await expectNoA11yViolations(page)

    await page.goto(`/tasks/${taskId}`)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Задача не найдена или недоступна' }),
    ).toBeVisible()
    await expectNoA11yViolations(page)

    await page.goto(`/objects/${objectId}`)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Объект не найден или недоступен' }),
    ).toBeVisible()
  })

  test('signing in as another user shows no stale data of the previous one', async ({ page }) => {
    const [m, a, b] = await Promise.all([
      createUser('manager', 'm'),
      createUser('executor', 'a'),
      createUser('executor', 'b'),
    ])
    const title = unique('Задача')
    const objectId = await createObject(m, unique('Объект'))
    await createTask(m, objectId, a, title)

    await login(page, a)
    await expect(page.getByRole('link', { name: title })).toBeVisible()
    await signOut(page)

    await login(page, b)
    await expect(page.getByRole('heading', { level: 1, name: 'Мои задачи' })).toBeVisible()
    await expect(page.getByText('Вам пока не назначено задач')).toBeVisible()
    await expect(page.getByRole('link', { name: title })).toHaveCount(0)
    await expect(page.getByText(a.fullName)).toHaveCount(0)
    await expect(profileButton(page)).toHaveAccessibleName(`Меню пользователя: ${b.fullName}`)
  })
})

test.describe('authentication', () => {
  test('unauthenticated access redirects to /login', async ({ page }) => {
    for (const path of ['/objects', '/my-tasks', '/tasks/00000000-0000-0000-0000-000000000000']) {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login$/)
    }
    await expect(page.getByRole('heading', { level: 1, name: 'Вход в Mini-CRM' })).toBeVisible()
  })

  test('wrong password shows an error and keeps the user on /login', async ({ page }) => {
    const a = await createUser('executor', 'a')
    await login(page, { email: a.email, password: 'Wrong-Password-1' }, { expectSuccess: false })
    await expect(page.getByRole('alert')).toHaveText('Неверный email или пароль')
    await expect(page).toHaveURL(/\/login$/)
    await expectNoA11yViolations(page)
  })

  test('forced password change on first login', async ({ page }) => {
    const newbie = await createUser('executor', 'newbie', { active: false })

    await login(page, newbie)
    await expect(page).toHaveURL(/\/change-password$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Смена пароля' })).toBeVisible()
    await expectNoA11yViolations(page)

    for (const path of ['/objects', '/my-tasks', '/']) {
      await page.goto(path)
      await expect(page).toHaveURL(/\/change-password$/)
    }

    await page.getByLabel('Новый пароль').fill('short')
    await page.getByLabel('Повторите пароль').fill('short')
    await page.getByRole('button', { name: 'Сменить пароль' }).click()
    await expect(page.getByText('Минимум 8 символов')).toBeVisible()
    await expect(page).toHaveURL(/\/change-password$/)
    await expectNoA11yViolations(page)

    const next = `New-${crypto.randomUUID()}`
    await page.getByLabel('Новый пароль').fill(next)
    await page.getByLabel('Повторите пароль').fill(`${next}x`)
    await page.getByRole('button', { name: 'Сменить пароль' }).click()
    await expect(page.getByText('Пароли не совпадают')).toBeVisible()

    await page.getByLabel('Повторите пароль').fill(next)
    await page.getByRole('button', { name: 'Сменить пароль' }).click()
    await expect(page).toHaveURL(/\/my-tasks$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Мои задачи' })).toBeVisible()
    await expectNoA11yViolations(page)
  })
})
