/// <reference lib="dom" />
import type { Page, Request, Response } from '@playwright/test'

import {
  createObject,
  createTask,
  createUser,
  expect,
  expectNoA11yViolations,
  login,
  test,
  type E2EUser,
} from './fixtures'

// T-025: search, sort and pagination of the three tables are done by the server (PostgREST) and live
// in the URL. Written before the implementation: with client-side paging the "server" and "debounce"
// tests are red by design; the URL/reload tests pass both before and after.

const PAGE_SIZE = 10
const uid = () => crypto.randomUUID().slice(0, 8)
const nn = (i: number) => String(i).padStart(2, '0')

const searchLabels = {
  objects: 'Поиск по названию и адресу',
  objectTasks: 'Поиск по названию и исполнителю',
  myTasks: 'Поиск по названию и объекту',
} as const

async function removeAll(m: E2EUser, taskIds: string[], objectIds: string[]): Promise<void> {
  await Promise.all(
    taskIds.map(async (id) => {
      const { error } = await m.client.rpc('delete_task', { p_task_id: id })
      if (error) throw error
    }),
  )
  await Promise.all(
    objectIds.map(async (id) => {
      const { error } = await m.client.rpc('delete_object', { p_object_id: id })
      if (error) throw error
    }),
  )
}

interface ListCase {
  name: string
  table: string
  search: string
  /** Opens the list as its user and returns the search token shared by every item name. */
  setup: (
    page: Page,
    count: number,
  ) => Promise<{ path: string; token: string; cleanup: () => Promise<void> }>
}

const listCases: ListCase[] = [
  {
    name: 'objects',
    table: 'Список объектов',
    search: searchLabels.objects,
    setup: async (page, count) => {
      const m = await createUser('manager', 'lst')
      const token = uid()
      const ids = await Promise.all(
        Array.from({ length: count }, (_, i) => createObject(m, `${token} ${nn(i + 1)}`, 'Адрес')),
      )
      await login(page, m)
      return {
        path: '/objects',
        token,
        cleanup: () => removeAll(m, [], ids),
      }
    },
  },
  {
    name: 'object tasks',
    table: 'Задачи объекта',
    search: searchLabels.objectTasks,
    setup: async (page, count) => {
      const [m, a] = await Promise.all([createUser('manager', 'lst'), createUser('executor', 'a')])
      const token = uid()
      const objectId = await createObject(m, `Объект ${token}`, 'Адрес')
      const taskIds = await Promise.all(
        Array.from({ length: count }, (_, i) =>
          createTask(m, objectId, a, `${token} ${nn(i + 1)}`),
        ),
      )
      await login(page, m)
      return {
        path: `/objects/${objectId}`,
        token,
        cleanup: () => removeAll(m, taskIds, [objectId]),
      }
    },
  },
  {
    name: 'my tasks',
    table: 'Мои задачи',
    search: searchLabels.myTasks,
    setup: async (page, count) => {
      const [m, a] = await Promise.all([createUser('manager', 'lst'), createUser('executor', 'a')])
      const token = uid()
      const objectId = await createObject(m, `Объект ${token}`, 'Адрес')
      const taskIds = await Promise.all(
        Array.from({ length: count }, (_, i) =>
          createTask(m, objectId, a, `${token} ${nn(i + 1)}`),
        ),
      )
      await login(page, a)
      return {
        path: '/my-tasks',
        token,
        cleanup: () => removeAll(m, taskIds, [objectId]),
      }
    },
  },
]

const pageStatus = (page: Page, current: number, total: number) =>
  page.getByRole('status').filter({ hasText: `Страница ${String(current)} из ${String(total)}` })

// --- list requests to PostgREST --------------------------------------------------------------

interface ListRequest {
  url: URL
  limit: number | null
  offset: number | null
  order: string | null
}

/** A paged list read: GET /rest/v1/objects|tasks carrying `limit` (or a Range header). */
function toListRequest(request: Request): ListRequest | null {
  if (request.method() !== 'GET') return null
  const url = new URL(request.url())
  if (!/\/rest\/v1\/(objects|tasks)$/.test(url.pathname)) return null
  const limitParam = url.searchParams.get('limit')
  const offsetParam = url.searchParams.get('offset')
  const range = /^(\d+)-(\d+)$/.exec(request.headers().range ?? '')
  if (limitParam !== null) {
    return {
      url,
      limit: Number(limitParam),
      offset: offsetParam === null ? 0 : Number(offsetParam),
      order: url.searchParams.get('order'),
    }
  }
  if (range) {
    const from = Number(range[1])
    return {
      url,
      limit: Number(range[2]) - from + 1,
      offset: from,
      order: url.searchParams.get('order'),
    }
  }
  return null
}

function trackListRequests(page: Page): ListRequest[] {
  const seen: ListRequest[] = []
  page.on('request', (request) => {
    const listRequest = toListRequest(request)
    if (listRequest) seen.push(listRequest)
  })
  return seen
}

/** A list response to this test's own query: the search token is in the request URL. */
const isListResponse = (response: Response, token: string, offset?: number): boolean => {
  const listRequest = toListRequest(response.request())
  return (
    listRequest !== null &&
    decodeURIComponent(listRequest.url.search).includes(token) &&
    (offset === undefined || listRequest.offset === offset)
  )
}

// --- the three tables: URL state, reload, out-of-range page, server paging ------------------------

for (const list of listCases) {
  test.describe(`${list.name}: search, sort and page live in the URL`, () => {
    test('survive a reload', async ({ page }) => {
      const { path, token, cleanup } = await list.setup(page, 25)
      try {
        await page.goto(path)
        const table = page.getByRole('table', { name: list.table })
        await page.getByRole('searchbox', { name: list.search }).fill(token)
        await expect(pageStatus(page, 1, 3)).toBeVisible()

        await page.getByRole('button', { name: 'Сортировка: Название' }).click()
        await page.getByRole('menuitem', { name: 'По убыванию' }).click()
        await expect(page).toHaveURL(/sort=-(name|title)/)
        await expect(table.getByRole('link', { name: `${token} 25`, exact: true })).toBeVisible()

        await page.getByRole('button', { name: 'Следующая страница' }).click()
        await expect(pageStatus(page, 2, 3)).toBeVisible()
        await expect(page).toHaveURL(/page=2/)

        await page.reload()
        await expect(pageStatus(page, 2, 3)).toBeVisible()
        await expect(page.getByRole('searchbox', { name: list.search })).toHaveValue(token)
        await expect(page).toHaveURL(/sort=-(name|title)/)
        await expect(page).toHaveURL(/page=2/)
        const names = (await table.getByRole('link').allInnerTexts())
          .map((text) => text.trim())
          .filter((text) => text.startsWith(token))
        // Descending by name: page 2 holds items 15 … 06.
        expect(names).toEqual(Array.from({ length: 10 }, (_, i) => `${token} ${nn(15 - i)}`))
      } finally {
        await cleanup()
      }
    })

    test('a page beyond the range opens the last page via replace, «Назад» skips it', async ({
      page,
    }) => {
      test.skip(test.info().project.name !== 'chromium-desktop', 'history behaviour is the same')
      const { path, token, cleanup } = await list.setup(page, 13)
      try {
        const start = `${path}?q=${encodeURIComponent(token)}`
        await page.goto(start)
        await expect(pageStatus(page, 1, 2)).toBeVisible()

        await page.goto(`${start}&page=999`)
        await expect(pageStatus(page, 2, 2)).toBeVisible()
        await expect(page).toHaveURL(/page=2/)
        await expect(page).not.toHaveURL(/page=999/)

        await page.goBack()
        await expect(page).not.toHaveURL(/page=/)
        await expect(pageStatus(page, 1, 2)).toBeVisible()
      } finally {
        await cleanup()
      }
    })

    test('the server pages: limit/offset + order in the request, one page in the response, total from the server', async ({
      page,
    }) => {
      test.skip(test.info().project.name !== 'chromium-desktop', 'network contract, not layout')
      const { path, token, cleanup } = await list.setup(page, 25)
      try {
        const requests = trackListRequests(page)
        const first = page.waitForResponse((r) => isListResponse(r, token, 0))
        // Neighbour pages are preloaded right after the shown one: their answers arrive before any click.
        const second = page.waitForResponse((r) => isListResponse(r, token, PAGE_SIZE))
        const last = page.waitForResponse((r) => isListResponse(r, token, 2 * PAGE_SIZE))
        await page.goto(`${path}?q=${encodeURIComponent(token)}`)
        const firstResponse = await first
        const firstRows = (await firstResponse.json()) as unknown[]
        expect(firstRows.length, 'rows in the first response').toBeLessThanOrEqual(PAGE_SIZE)
        expect(
          firstResponse.headers()['content-range'] ?? '',
          'exact total from the server (Content-Range)',
        ).toMatch(/\/25$/)

        const table = page.getByRole('table', { name: list.table })
        await expect(pageStatus(page, 1, 3)).toBeVisible()
        const ownRows = table.getByRole('row').filter({ hasText: token })
        await expect(ownRows).toHaveCount(PAGE_SIZE)
        expect(requests.length, 'a list request was made').toBeGreaterThan(0)
        for (const r of requests) {
          expect(r.limit, `limit in ${r.url.pathname}${r.url.search}`).toBe(PAGE_SIZE)
          expect(r.order, `order in ${r.url.pathname}${r.url.search}`).not.toBeNull()
        }

        await page.getByRole('button', { name: 'Следующая страница' }).click()
        const secondRows = (await (await second).json()) as unknown[]
        expect(secondRows.length).toBeLessThanOrEqual(PAGE_SIZE)
        await expect(pageStatus(page, 2, 3)).toBeVisible()

        await page.getByRole('button', { name: 'Последняя страница' }).click()
        const lastRows = (await (await last).json()) as unknown[]
        expect(lastRows).toHaveLength(5)
        await expect(pageStatus(page, 3, 3)).toBeVisible()
        await expect(ownRows).toHaveCount(5)

        // Sorting is sent to the server too (the page index resets).
        const sorted = page.waitForResponse((r) => {
          const listRequest = toListRequest(r.request())
          return isListResponse(r, token, 0) && /(name|title)\.desc/.test(listRequest?.order ?? '')
        })
        await page.getByRole('button', { name: 'Сортировка: Название' }).click()
        await page.getByRole('menuitem', { name: 'По убыванию' }).click()
        await sorted
        await expect(pageStatus(page, 1, 3)).toBeVisible()
      } finally {
        await cleanup()
      }
    })

    test('debounced search: five keystrokes make one request', async ({ page }) => {
      test.skip(test.info().project.name !== 'chromium-desktop', 'network contract, not layout')
      const { path, token, cleanup } = await list.setup(page, 3)
      try {
        await page.goto(path)
        const search = page.getByRole('searchbox', { name: list.search })
        await expect(search).toBeVisible()
        await expect(page.getByRole('table', { name: list.table })).toBeVisible()
        // The list has settled; count only the requests caused by typing.
        const requests = trackListRequests(page)
        await search.pressSequentially(token.slice(0, 5), { delay: 40 })
        await expect(search).toHaveValue(token.slice(0, 5))
        await expect
          .poll(() => requests.length, { message: 'search reached the server' })
          .toBeGreaterThan(0)
        await expect(page.getByRole('table', { name: list.table })).toBeVisible()
        await expect(pageStatus(page, 1, 1)).toBeVisible()
        expect(
          requests.map((r) => r.url.search),
          'exactly one request for five keystrokes',
        ).toHaveLength(1)
      } finally {
        await cleanup()
      }
    })
  })
}

// --- search scope ----------------------------------------------------------------------------------

test.describe('search by the related name', () => {
  test('object tasks: finds a task by the assignee name', async ({ page }) => {
    const [m, a, b] = await Promise.all([
      createUser('manager', 'srch'),
      createUser('executor', 'assignee-a'),
      createUser('executor', 'assignee-b'),
    ])
    const token = uid()
    const objectId = await createObject(m, `Объект ${token}`, 'Адрес')
    const taskIds = [
      await createTask(m, objectId, a, `Первая ${token}`),
      await createTask(m, objectId, b, `Вторая ${token}`),
    ]
    try {
      await login(page, m)
      await page.goto(`/objects/${objectId}`)
      await page.getByRole('searchbox', { name: searchLabels.objectTasks }).fill(a.fullName)
      const table = page.getByRole('table', { name: 'Задачи объекта' })
      await expect(table.getByRole('link', { name: `Первая ${token}`, exact: true })).toBeVisible()
      await expect(table.getByRole('link', { name: `Вторая ${token}`, exact: true })).toBeHidden()
      await expectNoA11yViolations(page)
    } finally {
      await removeAll(m, taskIds, [objectId])
    }
  })

  test('my tasks: finds a task by the object name', async ({ page }) => {
    const [m, a] = await Promise.all([createUser('manager', 'srch'), createUser('executor', 'a')])
    const token = uid()
    const firstObject = await createObject(m, `Склад ${token}`, 'Адрес')
    const secondObject = await createObject(m, `Офис ${token}`, 'Адрес')
    const taskIds = [
      await createTask(m, firstObject, a, `Задача один ${token}`),
      await createTask(m, secondObject, a, `Задача два ${token}`),
    ]
    try {
      await login(page, a)
      await page.getByRole('searchbox', { name: searchLabels.myTasks }).fill(`Склад ${token}`)
      const table = page.getByRole('table', { name: 'Мои задачи' })
      await expect(table.getByRole('link', { name: `Задача один ${token}` })).toBeVisible()
      await expect(table.getByRole('link', { name: `Задача два ${token}` })).toBeHidden()
      await expectNoA11yViolations(page)
    } finally {
      await removeAll(m, taskIds, [firstObject, secondObject])
    }
  })
})

test.describe('special characters in search are literal', () => {
  test('objects: % _ , ( do not act as wildcards or break the page', async ({ page }) => {
    const m = await createUser('manager', 'spec')
    const token = uid()
    const names = {
      percent: `Скидка 50% ${token}`,
      percentDecoy: `Скидка 50x ${token}`,
      underscore: `A_B ${token}`,
      underscoreDecoy: `AxB ${token}`,
      punctuation: `x,y(z ${token}`,
      punctuationDecoy: `x y z ${token}`,
    }
    const ids = await Promise.all(
      Object.values(names).map((name) => createObject(m, name, 'Адрес')),
    )
    try {
      await login(page, m)
      await page.goto('/objects')
      const search = page.getByRole('searchbox', { name: searchLabels.objects })
      const table = page.getByRole('table', { name: 'Список объектов' })
      const cases: [string, string, string][] = [
        [`50% ${token}`, names.percent, names.percentDecoy],
        [`A_B ${token}`, names.underscore, names.underscoreDecoy],
        [`x,y(z ${token}`, names.punctuation, names.punctuationDecoy],
      ]
      for (const [query, expected, decoy] of cases) {
        await search.fill(query)
        await expect(table.getByRole('link', { name: expected, exact: true })).toBeVisible()
        await expect(table.getByRole('link', { name: decoy, exact: true })).toBeHidden()
        await expect(table.getByRole('link')).toHaveCount(1)
        await expect(page.getByText('Не удалось загрузить объекты.')).toBeHidden()
      }
      // A lone `%` / `_` / `,` / `(` must not match everything nor error.
      for (const symbol of ['%', '_', ',', '(']) {
        await search.fill(`${symbol} ${token}`)
        await expect(page.getByText('Не удалось загрузить объекты.')).toBeHidden()
        await expect(table.getByRole('link', { name: names.punctuationDecoy })).toBeHidden()
      }
      await expect(page.getByRole('heading', { level: 1, name: 'Объекты' })).toBeVisible()
    } finally {
      await removeAll(m, [], ids)
    }
  })

  test('my tasks: a title with , and ( is found by that exact text', async ({ page }) => {
    const [m, a] = await Promise.all([createUser('manager', 'spec'), createUser('executor', 'a')])
    const token = uid()
    const objectId = await createObject(m, `Объект ${token}`, 'Адрес')
    const exact = `Акт (черновик), 100% ${token}`
    const decoy = `Акт черновик 100 ${token}`
    const taskIds = [
      await createTask(m, objectId, a, exact),
      await createTask(m, objectId, a, decoy),
    ]
    try {
      await login(page, a)
      await page.getByRole('searchbox', { name: searchLabels.myTasks }).fill(exact)
      const table = page.getByRole('table', { name: 'Мои задачи' })
      await expect(table.getByRole('link', { name: exact, exact: true })).toBeVisible()
      await expect(table.getByRole('link', { name: decoy, exact: true })).toBeHidden()
      await expect(page.getByText('Не удалось загрузить задачи')).toBeHidden()
    } finally {
      await removeAll(m, taskIds, [objectId])
    }
  })
})

// --- forbidden: an executor never sees another executor's tasks -------------------------------------

test.describe('«Мои задачи» never shows another executor’s tasks', () => {
  test('any URL parameters, direct API read included', async ({ page }) => {
    const [m, a, b] = await Promise.all([
      createUser('manager', 'iso'),
      createUser('executor', 'mine'),
      createUser('executor', 'other'),
    ])
    const token = uid()
    const objectId = await createObject(m, `Объект ${token}`, 'Адрес')
    const mine = `Моя ${token}`
    const foreign = `Чужая ${token}`
    const taskIds = [
      await createTask(m, objectId, a, mine),
      await createTask(m, objectId, b, foreign),
    ]
    try {
      await login(page, a)
      const table = page.getByRole('table', { name: 'Мои задачи' })
      await expect(table.getByRole('link', { name: mine, exact: true })).toBeVisible()
      await expect(table.getByRole('link', { name: foreign, exact: true })).toBeHidden()

      const urls = [
        `/my-tasks?q=${encodeURIComponent(b.fullName)}`,
        `/my-tasks?q=${encodeURIComponent(foreign)}`,
        `/my-tasks?q=${encodeURIComponent(token)}&size=50&page=1&sort=-title`,
        `/my-tasks?q=${encodeURIComponent(token)}&assignee=${b.id}&assignee_id=${b.id}`,
        `/my-tasks?q=${encodeURIComponent(token)}&page=999`,
      ]
      for (const url of urls) {
        await page.goto(url)
        await expect(page.getByRole('heading', { level: 1, name: 'Мои задачи' })).toBeVisible()
        await expect(page.getByRole('searchbox', { name: searchLabels.myTasks })).toBeVisible()
        await expect(page.getByText(foreign)).toBeHidden()
        await expect(page.getByText(b.fullName)).toBeHidden()
      }
      // Searching the other executor's name: nothing at all.
      await page.goto(`/my-tasks?q=${encodeURIComponent(b.fullName)}`)
      await expect(page.getByText('Ничего не найдено')).toBeVisible()
      await expect(table.getByRole('link')).toHaveCount(0)

      // Protection is in the database: a direct read as this executor returns no foreign rows.
      const { data, error } = await a.client
        .from('tasks')
        .select('id')
        .eq('assignee_id', b.id)
        .limit(10)
      expect(error).toBeNull()
      expect(data).toEqual([])
    } finally {
      await removeAll(m, taskIds, [objectId])
    }
  })
})
