/// <reference lib="dom" />
import type { APIResponse, Page } from '@playwright/test'

import { openObjectsFiltered } from './app-helpers'
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

// Route transitions and table paging are measured frame by frame (requestAnimationFrame):
// one page in the flow at a time, a still shell, a loader that appears late (or never), a table
// that does not blink to skeleton on a fast answer.

/** Route loader: role=status with this text. Change here if the implementation uses other wording. */
const LOADER_TEXT = /Загрузка/
const LOADER_DELAY_MS = 200
const SLOW_OBJECT_MS = 1_500
const SLOW_TABLE_MS = 1_000
const WINDOW_MS = 1_500
const PAGE_SIZE = 10

interface Frame {
  t: number
  h1Count: number
  mainCount: number
  /** Product of opacities from the first visible h1 up to the root (1 = fully shown). */
  h1Opacity: number | null
  h1Y: number | null
  h1Text: string | null
  /** Opacity of the table region (1 = fully shown). */
  tableOpacity: number | null
  /** Page scroll plus the scroll of the content area (0 = at the top). */
  scroll: number
  header: { y: number; h: number } | null
  sidebar: { x: number; y: number; w: number; h: number } | null
  mainHeight: number
  loaders: number
  skeletons: number
  rows: number
  tableHeight: number | null
  paginationY: number | null
}
interface Recorder {
  frames: Frame[]
  stopAt: number
  done: boolean
  /** ms from the start of the recording to the last click / popstate. */
  actionAt: number | null
}
interface RecorderWindow {
  __trRec?: Recorder
  __trStart?: (loader: string) => void
  __trMark?: (ms: number) => void
}

async function installRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as RecorderWindow
    w.__trStart = (loaderSource: string) => {
      const loaderRe = new RegExp(loaderSource)
      const t0 = performance.now()
      const rec: Recorder = {
        frames: [],
        stopAt: performance.now() + 60_000,
        done: false,
        actionAt: null,
      }
      w.__trRec = rec
      const markAction = () => {
        rec.actionAt ??= Math.round(performance.now() - t0)
      }
      document.addEventListener('click', markAction, true)
      window.addEventListener('popstate', markAction, true)
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      }
      const effectiveOpacity = (el: Element) => {
        let value = 1
        for (let node: Element | null = el; node; node = node.parentElement) {
          value *= Number(getComputedStyle(node).opacity)
        }
        return value
      }
      const read = (): Frame => {
        const main = document.getElementById('main-content')
        const h1s = Array.from(main?.querySelectorAll('h1') ?? []).filter(visible)
        const first = h1s[0]
        const header = document.querySelector('header')?.getBoundingClientRect()
        const nav = document
          .querySelector('nav[aria-label="Основная навигация"]')
          ?.getBoundingClientRect()
        const table = main?.querySelector('table')
        const region = table?.parentElement?.getBoundingClientRect()
        const pagination = main
          ?.querySelector('nav[aria-label="Пагинация"]')
          ?.getBoundingClientRect()
        return {
          t: Math.round(performance.now() - t0),
          h1Count: h1s.length,
          mainCount: document.querySelectorAll('#main-content').length,
          h1Opacity: first ? effectiveOpacity(first) : null,
          h1Y: first ? first.getBoundingClientRect().y : null,
          h1Text: first ? first.textContent : null,
          tableOpacity: table ? effectiveOpacity(table) : null,
          scroll: Math.round(window.scrollY + (main?.scrollTop ?? 0)),
          header: header ? { y: header.y, h: header.height } : null,
          sidebar: nav ? { x: nav.x, y: nav.y, w: nav.width, h: nav.height } : null,
          mainHeight: main?.scrollHeight ?? 0,
          loaders: Array.from(document.querySelectorAll('[role="status"]')).filter(
            (el) => visible(el) && loaderRe.test(el.textContent),
          ).length,
          skeletons: main?.querySelectorAll('table [data-slot="skeleton"]').length ?? 0,
          rows: main?.querySelectorAll('table tbody tr').length ?? 0,
          tableHeight: region?.height ?? null,
          paginationY: pagination?.y ?? null,
        }
      }
      const tick = () => {
        rec.frames.push(read())
        if (performance.now() < rec.stopAt) requestAnimationFrame(tick)
        else rec.done = true
      }
      requestAnimationFrame(tick)
    }
    w.__trMark = (ms) => {
      if (w.__trRec) w.__trRec.stopAt = performance.now() + ms
    }
  })
}

interface Recording {
  frames: Frame[]
  actionAt: number
}

/** Records every animation frame while `action` runs and for `windowMs` after it returned. */
async function record(
  page: Page,
  action: () => Promise<void>,
  windowMs = WINDOW_MS,
): Promise<Recording> {
  await page.evaluate((source) => {
    ;(window as unknown as RecorderWindow).__trStart?.(source)
  }, LOADER_TEXT.source)
  await action()
  await page.evaluate((ms) => {
    ;(window as unknown as RecorderWindow).__trMark?.(ms)
  }, windowMs)
  await page.waitForFunction(() => (window as unknown as RecorderWindow).__trRec?.done === true)
  const rec = await page.evaluate(() => (window as unknown as RecorderWindow).__trRec)
  if (!rec) throw new Error('recorder did not run')
  return { frames: rec.frames, actionAt: rec.actionAt ?? 0 }
}

/** Header and sidebar of the stable state before the action. */
const shellOf = (page: Page) =>
  page.evaluate(() => {
    const header = document.querySelector('header')?.getBoundingClientRect()
    const nav = document
      .querySelector('nav[aria-label="Основная навигация"]')
      ?.getBoundingClientRect()
    return {
      header: header ? { y: header.y, h: header.height } : null,
      sidebar: nav ? { x: nav.x, y: nav.y, w: nav.width, h: nav.height } : null,
    }
  })

type Shell = Awaited<ReturnType<typeof shellOf>>

const near = (a: number, b: number) => Math.abs(a - b) <= 1

/** Problems that must not occur in any frame of a route change (one page in the flow, still shell). */
function routeProblems(frames: Frame[], shell: Shell): string[] {
  const problems: string[] = []
  const minHeight = Math.min(...frames.map((f) => f.mainHeight))
  if (frames.length <= 10) problems.push(`only ${String(frames.length)} frames recorded`)
  for (const f of frames) {
    if (f.h1Count > 1) problems.push(`t=${String(f.t)}ms ${String(f.h1Count)} visible h1 at once`)
    if (f.mainCount > 1) problems.push(`t=${String(f.t)}ms ${String(f.mainCount)} #main-content`)
    if (
      shell.header &&
      f.header &&
      !(near(f.header.y, shell.header.y) && near(f.header.h, shell.header.h))
    )
      problems.push(
        `t=${String(f.t)}ms banner moved: y ${f.header.y.toFixed(1)} h ${f.header.h.toFixed(1)}`,
      )
    if (
      shell.sidebar &&
      f.sidebar &&
      !(
        near(f.sidebar.x, shell.sidebar.x) &&
        near(f.sidebar.y, shell.sidebar.y) &&
        near(f.sidebar.w, shell.sidebar.w) &&
        near(f.sidebar.h, shell.sidebar.h)
      )
    )
      problems.push(
        `t=${String(f.t)}ms sidebar moved: y ${f.sidebar.y.toFixed(1)} h ${f.sidebar.h.toFixed(1)}`,
      )
  }
  // The content area never collapses (a vanished page without a loader would shrink it to the shell).
  if (minHeight < 300) problems.push(`content height dropped to ${String(minHeight)}px`)
  return [...new Set(problems)].slice(0, 12)
}

const loaderFrames = (frames: Frame[]) => frames.filter((f) => f.loaders > 0)

interface Fixture {
  m: E2EUser
  token: string
  nameA: string
  nameB: string
  titleA: string
  titleB: string
  idA: string
  idB: string
  cleanup: () => Promise<void>
}

/** Two objects with one task each (own data), soft-deleted at the end. */
async function seed(): Promise<Fixture> {
  const [m, a] = await Promise.all([createUser('manager', 'trans'), createUser('executor', 'a')])
  const token = crypto.randomUUID().slice(0, 8)
  const nameA = `Переход ${token} A`
  const nameB = `Переход ${token} B`
  const titleA = `Задача ${token} A`
  const titleB = `Задача ${token} B`
  const idA = await createObject(m, nameA, 'Адрес')
  const idB = await createObject(m, nameB, 'Адрес')
  const taskA = await createTask(m, idA, a, titleA)
  const taskB = await createTask(m, idB, a, titleB)
  const cleanup = async () => {
    for (const id of [taskA, taskB]) {
      const r = await m.client.rpc('delete_task', { p_task_id: id })
      if (r.error) throw r.error
    }
    for (const id of [idA, idB]) {
      const r = await m.client.rpc('delete_object', { p_object_id: id })
      if (r.error) throw r.error
    }
  }
  return { m, token, nameA, nameB, titleA, titleB, idA, idB, cleanup }
}

interface Hold {
  release: () => void
}

/** Holds PostgREST answers of `objects` matching `match` until released (or `delayMs` passed). */
async function delayObjects(
  page: Page,
  match: (url: URL) => boolean,
  delayMs?: number,
): Promise<Hold> {
  let release: () => void = () => undefined
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(
    (url) => url.pathname.endsWith('/rest/v1/objects') && match(url),
    async (route) => {
      await (delayMs === undefined
        ? released
        : new Promise<void>((resolve) => setTimeout(resolve, delayMs)))
      try {
        await route.continue()
      } catch {
        // The page was closed while the answer was held.
      }
    },
  )
  return { release }
}

/**
 * Records GET answers of PostgREST; after `start()` a request seen before is answered at once from
 * the copy (no network, no database), so the "fast answer" holds by construction.
 */
async function replayRestAnswers(page: Page): Promise<{ start: () => void; hits: () => number }> {
  const copies = new Map<string, { response: APIResponse; body: Buffer }>()
  let replaying = false
  let hits = 0
  await page.context().route(
    (url) => url.pathname.includes('/rest/v1/'),
    async (route) => {
      const request = route.request()
      const key = `${request.method()} ${request.url()}`
      const copy = copies.get(key)
      if (replaying && copy) {
        hits += 1
        await route.fulfill(copy)
        return
      }
      const response = await route.fetch()
      const body = await response.body()
      if (request.method() === 'GET' && response.ok()) copies.set(key, { response, body })
      await route.fulfill({ response, body })
    },
  )
  return {
    start: () => {
      replaying = true
    },
    hits: () => hits,
  }
}

const byId = (id: string) => (url: URL) => url.searchParams.get('id')?.includes(id) === true

const link = (page: Page, name: string) => page.getByRole('link', { name, exact: true })

async function seedMany(): Promise<{
  m: E2EUser
  token: string
  cleanup: () => Promise<void>
}> {
  const m = await createUser('manager', 'trans-table')
  const token = crypto.randomUUID().slice(0, 8)
  const ids = await Promise.all(
    Array.from({ length: PAGE_SIZE * 3 }, (_, i) =>
      createObject(m, `Таблица ${token} ${String(i + 1).padStart(2, '0')}`, 'Адрес'),
    ),
  )
  const cleanup = async () => {
    for (const id of ids) {
      const r = await m.client.rpc('delete_object', { p_object_id: id })
      if (r.error) throw r.error
    }
  }
  return { m, token, cleanup }
}

/** Opens the filtered list and waits until the neighbour page is in the cache (its answer arrived). */
async function openPreloaded(page: Page, token: string): Promise<void> {
  const prefetched = page.waitForResponse((r) => {
    const url = new URL(r.url())
    return (
      url.pathname.endsWith('/rest/v1/objects') &&
      url.searchParams.get('offset') === String(PAGE_SIZE) &&
      decodeURIComponent(url.search).includes(token)
    )
  })
  await openObjectsFiltered(page, token)
  await prefetched
  await expect(page.getByRole('row')).toHaveCount(PAGE_SIZE + 1)
}

const nextPage = (page: Page) => page.getByRole('button', { name: 'Следующая страница' })

/** Jumps from page 1 to the last of three pages: the button on desktop, the page list on mobile. */
async function jumpToLastPage(page: Page, isMobile: boolean): Promise<void> {
  if (isMobile) {
    await page.getByRole('combobox', { name: 'Страница 1 из 3' }).click()
    await page.getByRole('option', { name: 'Страница 3 из 3' }).click()
  } else {
    await page.getByRole('button', { name: 'Последняя страница' }).click()
  }
}

/** Desktop runs at 1280x800; Pixel 7 keeps its own viewport (the page scrolls, the sidebar is a sheet). */
function useProjectViewport(): void {
  test.beforeEach(async ({ page, isMobile }) => {
    if (!isMobile) await page.setViewportSize({ width: 1280, height: 800 })
  })
}

/** Scrolls the page and the content area to the very bottom; returns how far the content moved. */
const scrollToBottom = (page: Page) =>
  page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight)
    const main = document.getElementById('main-content')
    if (main) main.scrollTop = main.scrollHeight
    return Math.round(window.scrollY + (main?.scrollTop ?? 0))
  })

test.describe('route transitions (frame by frame)', () => {
  test.use({ reducedMotion: 'no-preference' })
  useProjectViewport()

  test('objects -> object -> task -> back -> back: one page at a time, still shell, cached back has no loader', async ({
    page,
  }) => {
    const f = await seed()
    try {
      await installRecorder(page)
      await login(page, f.m)
      await openObjectsFiltered(page, f.token)
      await expect(link(page, f.nameA)).toBeVisible()
      const shell = await shellOf(page)

      const steps: { label: string; cached: boolean; frames: Frame[] }[] = []
      let rec = await record(page, () => link(page, f.nameA).click())
      steps.push({ label: 'objects -> object', cached: false, frames: rec.frames })
      await expect(page.getByRole('heading', { level: 1, name: f.nameA })).toBeVisible()
      await expect(link(page, f.titleA)).toBeVisible()
      rec = await record(page, () => link(page, f.titleA).click())
      steps.push({ label: 'object -> task', cached: false, frames: rec.frames })
      await expect(page.getByRole('heading', { level: 1, name: f.titleA })).toBeVisible()
      rec = await record(page, async () => {
        await page.goBack()
      })
      steps.push({ label: 'task -> back to object', cached: true, frames: rec.frames })
      await expect(page.getByRole('heading', { level: 1, name: f.nameA })).toBeVisible()
      rec = await record(page, async () => {
        await page.goBack()
      })
      steps.push({ label: 'object -> back to objects', cached: true, frames: rec.frames })
      await expect(page.getByRole('heading', { level: 1, name: 'Объекты' })).toBeVisible()

      const problems = steps.flatMap((s) =>
        routeProblems(s.frames, shell).map((p) => `${s.label}: ${p}`),
      )
      expect(problems, 'route change violations').toEqual([])
      for (const s of steps.filter((x) => x.cached)) {
        expect(loaderFrames(s.frames).length, `${s.label}: no loader when data is cached`).toBe(0)
      }
    } finally {
      await f.cleanup()
    }
  })

  test('fast answer: the route loader does not flash at all', async ({ page }) => {
    const f = await seed()
    try {
      await installRecorder(page)
      const replay = await replayRestAnswers(page)
      await login(page, f.m)
      await openObjectsFiltered(page, f.token)
      // Warm-up: route chunks of the object and task pages are loaded, the data of B is not cached.
      await link(page, f.nameA).click()
      await link(page, f.titleA).click()
      await expect(page.getByRole('heading', { level: 1, name: f.titleA })).toBeVisible()
      await page.goBack()
      await page.goBack()
      await expect(link(page, f.nameB)).toBeVisible()

      // The real answers for B are fetched by a second tab of the same session (its own query cache),
      // then replayed instantly: the answer time no longer depends on the load of the machine.
      const other = await page.context().newPage()
      await other.goto(`/objects?q=${encodeURIComponent(f.token)}`)
      await link(other, f.nameB).click()
      await link(other, f.titleB).click()
      await expect(other.getByRole('heading', { level: 1, name: f.titleB })).toBeVisible()
      await other.close()
      replay.start()

      const toObject = await record(page, () => link(page, f.nameB).click())
      await expect(page.getByRole('heading', { level: 1, name: f.nameB })).toBeVisible()
      const toTask = await record(page, () => link(page, f.titleB).click())
      await expect(page.getByRole('heading', { level: 1, name: f.titleB })).toBeVisible()
      expect(replay.hits(), 'the answers came from the recorded copies').toBeGreaterThan(0)
      expect(loaderFrames(toObject.frames).length, 'objects -> object: no loader').toBe(0)
      expect(loaderFrames(toTask.frames).length, 'object -> task: no loader').toBe(0)
    } finally {
      await f.cleanup()
    }
  })

  test('slow answer: loader appears after ~200 ms, holds the area, goes away with the data', async ({
    page,
  }) => {
    const f = await seed()
    try {
      await installRecorder(page)
      await login(page, f.m)
      await openObjectsFiltered(page, f.token)
      await expect(link(page, f.nameB)).toBeVisible()
      const shell = await shellOf(page)
      await delayObjects(page, byId(f.idB), SLOW_OBJECT_MS)

      const rec = await record(
        page,
        async () => {
          await link(page, f.nameB).click()
          await expect(page.getByRole('heading', { level: 1, name: f.nameB })).toBeVisible({
            timeout: 10_000,
          })
        },
        800,
      )
      const withLoader = loaderFrames(rec.frames)
      expect(withLoader.length, 'the loader is shown while the answer is held').toBeGreaterThan(0)
      const first = (withLoader[0]?.t ?? 0) - rec.actionAt
      const last = (withLoader.at(-1)?.t ?? 0) - rec.actionAt
      expect(
        first,
        'loader is not shown earlier than ~200 ms (minus 1 frame / click jitter)',
      ).toBeGreaterThanOrEqual(LOADER_DELAY_MS - 50)
      expect(first, 'loader appears soon after the delay').toBeLessThanOrEqual(
        LOADER_DELAY_MS + 400,
      )
      expect(last, 'loader stays until the data arrives (~1500 ms)').toBeGreaterThanOrEqual(
        SLOW_OBJECT_MS - 300,
      )
      expect(rec.frames.at(-1)?.loaders, 'no loader after the data arrived').toBe(0)
      // Flicker = the loader goes away and comes back before the data arrived. Judged by the order of
      // DOM states, not by frame gaps (requestAnimationFrame is throttled when the machine is busy).
      const shown = rec.frames.map((fr) => fr.loaders > 0)
      expect(
        shown.slice(shown.indexOf(true), shown.lastIndexOf(true) + 1).every(Boolean),
        'loader does not flicker',
      ).toBe(true)
      expect(routeProblems(rec.frames, shell), 'route change violations').toEqual([])
    } finally {
      await f.cleanup()
    }
  })

  test('page change is animated: content fades through intermediate opacity, no layout jump of the shell', async ({
    page,
  }) => {
    const f = await seed()
    try {
      await installRecorder(page)
      await login(page, f.m)
      await openObjectsFiltered(page, f.token)
      await expect(link(page, f.nameA)).toBeVisible()
      const rec = await record(page, () => link(page, f.nameA).click())
      const intermediate = rec.frames.filter(
        (fr) => fr.h1Opacity !== null && fr.h1Opacity > 0.02 && fr.h1Opacity < 0.98,
      )
      expect(
        intermediate.length,
        'frames with a partly transparent page title (fade)',
      ).toBeGreaterThan(2)
      const settled = rec.frames
        .filter((fr) => fr.h1Opacity !== null && fr.h1Opacity >= 0.99)
        .at(-1)
      expect(settled, 'the new page ends fully opaque').toBeDefined()
      // The new title comes in with a small shift only (not a jump across the screen).
      const ys = rec.frames.flatMap((fr) => (fr.h1Y === null ? [] : [fr.h1Y]))
      const finalY = ys.at(-1) ?? 0
      expect(
        Math.max(...ys.map((y) => Math.abs(y - finalY))),
        'title shift stays small (<= 40 px)',
      ).toBeLessThanOrEqual(40)
    } finally {
      await f.cleanup()
    }
  })
})

test.describe('route change on a scrolled page and focus', () => {
  test.use({ reducedMotion: 'no-preference' })
  useProjectViewport()

  test('the new page starts at the top (title in view); the leaving page does not jump during its fade', async ({
    page,
    isMobile,
  }) => {
    // Below 600 px of height the page itself scrolls on desktop too (above it only the table body does).
    if (!isMobile) await page.setViewportSize({ width: 1280, height: 560 })
    const d = await seedMany()
    try {
      await installRecorder(page)
      await login(page, d.m)
      await openObjectsFiltered(page, d.token)
      await expect(page.getByRole('row')).toHaveCount(PAGE_SIZE + 1)
      const scrolled = await scrollToBottom(page)
      expect(scrolled, 'the list is scrolled down before leaving it').toBeGreaterThan(50)

      const rec = await record(page, () => page.getByRole('row').last().getByRole('link').click())
      const title = page.getByRole('heading', {
        level: 1,
        name: new RegExp(`^Таблица ${d.token} \\d\\d$`),
      })
      await expect(title).toBeVisible()
      await expect(title, 'the new title is inside the viewport').toBeInViewport({ ratio: 1 })
      expect(await page.evaluate(() => window.scrollY), 'window is at the top').toBe(0)
      expect(rec.frames.at(-1)?.scroll, 'content area is at the top').toBe(0)

      const before = rec.frames
        .filter((fr) => fr.t < rec.actionAt && fr.h1Text === 'Объекты')
        .at(-1)
      const leaving = rec.frames.filter((fr) => fr.t >= rec.actionAt && fr.h1Text === 'Объекты')
      expect(leaving.length, 'the leaving page was seen during its fade').toBeGreaterThan(2)
      const moved = leaving.filter((fr) => Math.abs((fr.h1Y ?? 0) - (before?.h1Y ?? 0)) > 9)
      expect(
        moved
          .slice(0, 5)
          .map((fr) => `t=${String(fr.t)}ms y ${String(fr.h1Y)} (was ${String(before?.h1Y)})`),
        'the leaving title stays in place (only its own <= 8 px fade shift)',
      ).toEqual([])
    } finally {
      await d.cleanup()
    }
  })

  test('focus is exactly on the main region after following a link', async ({ page }) => {
    const f = await seed()
    try {
      await login(page, f.m)
      await openObjectsFiltered(page, f.token)
      await link(page, f.nameA).click()
      await expect(page.getByRole('heading', { level: 1, name: f.nameA })).toBeVisible()
      await expect(page.getByRole('main'), 'focus is on #main-content').toBeFocused()
    } finally {
      await f.cleanup()
    }
  })
})

test.describe('table paging (frame by frame)', () => {
  test.use({ reducedMotion: 'no-preference' })
  useProjectViewport()

  test('fast answer: old rows are replaced by new ones, skeleton never shows, page title is untouched', async ({
    page,
  }) => {
    const d = await seedMany()
    try {
      await installRecorder(page)
      await login(page, d.m)
      await openPreloaded(page, d.token)
      await expect(page.getByRole('row')).toHaveCount(PAGE_SIZE + 1)
      const firstRow = await page.getByRole('row').nth(1).innerText()

      const rec = await record(page, () => nextPage(page).click())
      await expect(page.getByRole('row').nth(1)).not.toHaveText(firstRow)
      expect(rec.frames.filter((fr) => fr.skeletons > 0).length, 'frames with skeleton rows').toBe(
        0,
      )
      expect(
        Math.min(...rec.frames.map((fr) => fr.rows)),
        'the table never empties',
      ).toBeGreaterThan(0)

      // Only page / q changed: the page itself is not re-animated.
      const docY = (fr: Frame) => (fr.h1Y ?? -9999) + fr.scroll
      const baseY = rec.frames[0] ? docY(rec.frames[0]) : 0
      const bad = rec.frames.filter(
        (fr) => fr.h1Opacity === null || fr.h1Opacity < 0.99 || !near(docY(fr), baseY),
      )
      expect(bad.slice(0, 5), 'h1 stays opaque and in place while paging').toEqual([])
      expect(
        rec.frames.filter((fr) => fr.h1Count !== 1).length,
        'exactly one h1 in every frame',
      ).toBe(0)

      // A search narrows the list: same invariants.
      const search = await record(page, async () => {
        await page.getByRole('searchbox').first().fill(`${d.token} 01`)
        await expect(page.getByRole('row')).toHaveCount(2)
      })
      const badSearch = search.frames.filter(
        (fr) => fr.h1Opacity === null || fr.h1Opacity < 0.99 || !near(docY(fr), baseY),
      )
      expect(badSearch.slice(0, 5), 'h1 stays opaque and in place while searching').toEqual([])
    } finally {
      await d.cleanup()
    }
  })

  test('slow answer for a page that was not preloaded: skeleton without a height or toolbar jump, then rows replace it', async ({
    page,
    isMobile,
  }) => {
    const d = await seedMany()
    try {
      await installRecorder(page)
      await login(page, d.m)
      await openObjectsFiltered(page, d.token)
      await expect(page.getByRole('row')).toHaveCount(PAGE_SIZE + 1)
      const before = await page.evaluate(() => {
        const main = document.getElementById('main-content')
        return {
          table: main?.querySelector('table')?.parentElement?.getBoundingClientRect().height ?? 0,
          pagination:
            (main?.querySelector('nav[aria-label="Пагинация"]')?.getBoundingClientRect().y ?? 0) +
            window.scrollY +
            (main?.scrollTop ?? 0),
        }
      })
      // Page 2 is preloaded in the background, page 3 is not: only a jump to it waits for the network.
      const farOffset = String(PAGE_SIZE * 2)
      await delayObjects(page, (url) => url.searchParams.get('offset') === farOffset, SLOW_TABLE_MS)

      const rec = await record(
        page,
        async () => {
          const answered = page.waitForResponse(
            (r) => new URL(r.url()).searchParams.get('offset') === farOffset,
          )
          await jumpToLastPage(page, isMobile)
          await answered
        },
        600,
      )
      expect(
        rec.frames.filter((fr) => fr.skeletons > 0).length,
        'skeleton rows are shown while loading',
      ).toBeGreaterThan(0)
      expect(rec.frames.at(-1)?.skeletons, 'no skeleton after the rows arrived').toBe(0)
      const jumps = rec.frames.flatMap((fr) => {
        const out: string[] = []
        if (fr.tableHeight !== null && !near(fr.tableHeight, before.table))
          out.push(
            `t=${String(fr.t)}ms table area ${before.table.toFixed(1)} -> ${fr.tableHeight.toFixed(1)}`,
          )
        const paginationDocY = fr.paginationY === null ? null : fr.paginationY + fr.scroll
        if (paginationDocY !== null && !near(paginationDocY, before.pagination))
          out.push(
            `t=${String(fr.t)}ms pagination y ${before.pagination.toFixed(1)} -> ${paginationDocY.toFixed(1)}`,
          )
        return out
      })
      expect([...new Set(jumps)].slice(0, 8), 'table area and pagination do not jump').toEqual([])
    } finally {
      await d.cleanup()
    }
  })
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })
  useProjectViewport()

  test('route change is instant: no partly transparent or shifted content; focus after the change', async ({
    page,
  }) => {
    const f = await seed()
    try {
      await installRecorder(page)
      await login(page, f.m)
      await openObjectsFiltered(page, f.token)
      await expect(link(page, f.nameA)).toBeVisible()

      const rec = await record(page, () => link(page, f.nameA).click())
      await expect(page.getByRole('heading', { level: 1, name: f.nameA })).toBeVisible()
      const partly = rec.frames.filter(
        (fr) => fr.h1Opacity !== null && fr.h1Opacity > 0.01 && fr.h1Opacity < 0.99,
      )
      expect(partly.slice(0, 5), 'no intermediate opacity').toEqual([])
      const ys = rec.frames.flatMap((fr) => (fr.h1Y === null ? [] : [fr.h1Y]))
      const finalY = ys.at(-1) ?? 0
      expect(ys.filter((y) => !near(y, finalY)).slice(0, 5), 'no shift of the page title').toEqual(
        [],
      )
      expect(rec.frames.filter((fr) => fr.h1Count > 1).length, 'never two titles').toBe(0)

      // The clicked link is gone with the old page: focus moves to the start of the new content.
      await expect(page.getByRole('main'), 'focus is exactly on #main-content').toBeFocused()
    } finally {
      await f.cleanup()
    }
  })
})

test.describe('reduced motion: paging', () => {
  test.use({ reducedMotion: 'reduce' })
  useProjectViewport()

  test('data is replaced without an intermediate opacity or a title change', async ({ page }) => {
    const d = await seedMany()
    try {
      await installRecorder(page)
      await login(page, d.m)
      await openPreloaded(page, d.token)
      await expect(page.getByRole('row')).toHaveCount(PAGE_SIZE + 1)
      const firstRow = await page.getByRole('row').nth(1).innerText()
      const rec = await record(page, () => nextPage(page).click())
      await expect(page.getByRole('row').nth(1)).not.toHaveText(firstRow)
      const partly = rec.frames.filter(
        (fr) => fr.tableOpacity !== null && fr.tableOpacity > 0.01 && fr.tableOpacity < 0.99,
      )
      expect(partly.slice(0, 5), 'no intermediate opacity of the table').toEqual([])
      expect(rec.frames.filter((fr) => fr.h1Count !== 1).length, 'one title in every frame').toBe(0)
    } finally {
      await d.cleanup()
    }
  })
})

test.describe('neighbour pages are preloaded', () => {
  test.use({ reducedMotion: 'no-preference' })
  useProjectViewport()

  const isListRequest = (token: string, offset: number) => (url: URL) =>
    url.pathname.endsWith('/rest/v1/objects') &&
    url.searchParams.get('offset') === String(offset) &&
    decodeURIComponent(url.search).includes(token)

  test('page 2 is already requested; «Next» shows it with no new request and no skeleton', async ({
    page,
  }) => {
    const d = await seedMany()
    try {
      await installRecorder(page)
      await login(page, d.m)
      const prefetched = page.waitForResponse((r) =>
        isListRequest(d.token, PAGE_SIZE)(new URL(r.url())),
      )
      await openObjectsFiltered(page, d.token)
      await prefetched
      await expect(page.getByRole('row')).toHaveCount(PAGE_SIZE + 1)
      const firstRow = await page.getByRole('row').nth(1).innerText()

      // Anything asked for page 2 from now on would be slow: the answer must already be cached.
      await delayObjects(page, isListRequest(d.token, PAGE_SIZE), SLOW_TABLE_MS)
      const again: string[] = []
      page.on('request', (r) => {
        if (isListRequest(d.token, PAGE_SIZE)(new URL(r.url()))) again.push(r.url())
      })
      const rec = await record(
        page,
        async () => {
          await nextPage(page).click()
          await expect(page.getByRole('row').nth(1)).not.toHaveText(firstRow, { timeout: 800 })
        },
        400,
      )
      expect(again, 'no new request for the cached page').toEqual([])
      expect(rec.frames.filter((fr) => fr.skeletons > 0).length, 'frames with skeleton rows').toBe(
        0,
      )
      expect(
        Math.min(...rec.frames.map((fr) => fr.rows)),
        'the table never empties',
      ).toBeGreaterThan(0)
    } finally {
      await d.cleanup()
    }
  })
})

test.describe('a11y while the route loader is shown', () => {
  // Runs on desktop and on Pixel 7 (both projects).
  test('axe finds no serious violations while the loader is visible', async ({ page }) => {
    const f = await seed()
    try {
      await login(page, f.m)
      await openObjectsFiltered(page, f.token)
      await expect(link(page, f.nameA)).toBeVisible()
      const hold = await delayObjects(page, byId(f.idA))
      await link(page, f.nameA).click()
      const loader = page.getByRole('status').filter({ hasText: LOADER_TEXT })
      await expect(loader).toBeVisible()
      await expectNoA11yViolations(page)
      hold.release()
      await expect(page.getByRole('heading', { level: 1, name: f.nameA })).toBeVisible()
      await expect(loader).toBeHidden()
    } finally {
      await f.cleanup()
    }
  })
})
