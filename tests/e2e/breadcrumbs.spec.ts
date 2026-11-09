/// <reference lib="dom" />
import type { Page } from '@playwright/test'

import { openObjectsFiltered, watchHiddenFocus } from './app-helpers'
import { createObject, createTask, createUser, expect, login, test, type E2EUser } from './fixtures'

test.skip(({ isMobile }) => isMobile, 'breadcrumb animation is measured on desktop 1280x800')
test.use({ viewport: { width: 1280, height: 800 } })

const WINDOW_MS = 1_500
const RELOAD_WINDOW_MS = 2_500

interface Crumb {
  text: string
  x: number
  w: number
  opacity: number
  current: boolean
}
interface Frame {
  t: number
  crumbs: Crumb[]
}
interface Recorder {
  frames: Frame[]
  stopAt: number
  done: boolean
}
interface RecorderWindow {
  __crumbRec?: Recorder
  __startCrumbRec?: (ms?: number) => void
  __markCrumbRec?: (ms: number) => void
}

/** Defines the frame recorder in every document; `sessionStorage['e2e-crumbs']` auto-starts it on load. */
async function installRecorder(page: Page): Promise<void> {
  await page.addInitScript((windowMs: number) => {
    const w = window as unknown as RecorderWindow
    const read = (): Crumb[] => {
      const nav = document.querySelector('header nav[aria-label="Навигация по страницам"]')
      if (!nav) return []
      return Array.from(nav.querySelectorAll('li'))
        .filter((li) => li.getAttribute('role') !== 'presentation')
        .map((li) => {
          const r = li.getBoundingClientRect()
          return {
            text: (li as HTMLElement).innerText.trim(),
            x: r.x,
            w: r.width,
            opacity: Number(getComputedStyle(li).opacity),
            current: li.querySelector('[aria-current="page"]') !== null,
          }
        })
    }
    w.__startCrumbRec = (ms = windowMs) => {
      const rec: Recorder = { frames: [], stopAt: performance.now() + ms, done: false }
      w.__crumbRec = rec
      const t0 = performance.now()
      const tick = () => {
        rec.frames.push({ t: Math.round(performance.now() - t0), crumbs: read() })
        if (performance.now() < rec.stopAt) requestAnimationFrame(tick)
        else rec.done = true
      }
      requestAnimationFrame(tick)
    }
    w.__markCrumbRec = (ms) => {
      if (w.__crumbRec) w.__crumbRec.stopAt = performance.now() + ms
    }
    if (window.sessionStorage.getItem('e2e-crumbs') === '1') w.__startCrumbRec(windowMs)
  }, RELOAD_WINDOW_MS)
}

const snapshot = (page: Page) =>
  page.evaluate(() => {
    const nav = document.querySelector('header nav[aria-label="Навигация по страницам"]')
    return Array.from(nav?.querySelectorAll('li') ?? [])
      .filter((li) => li.getAttribute('role') !== 'presentation')
      .map((li) => {
        const r = li.getBoundingClientRect()
        return {
          text: (li as HTMLElement).innerText.trim(),
          x: r.x,
          w: r.width,
          opacity: Number(getComputedStyle(li).opacity),
          current: li.querySelector('[aria-current="page"]') !== null,
        }
      })
  })

/** Runs `action` while recording every animation frame until WINDOW_MS after it returned. */
async function record(page: Page, action: () => Promise<void>): Promise<Frame[]> {
  await page.evaluate(() => {
    ;(window as unknown as RecorderWindow).__startCrumbRec?.(60_000)
  })
  await action()
  await page.evaluate((ms) => {
    ;(window as unknown as RecorderWindow).__markCrumbRec?.(ms)
  }, WINDOW_MS)
  await page.waitForFunction(() => (window as unknown as RecorderWindow).__crumbRec?.done === true)
  return page.evaluate(() => (window as unknown as RecorderWindow).__crumbRec?.frames ?? [])
}

interface Expectation {
  label: string
  frames: Frame[]
  before: Crumb[]
  chain: string[]
  checkPersistent?: boolean
}

const texts = (crumbs: Crumb[]) => crumbs.map((c) => c.text)

function checkTransition({
  label,
  frames,
  before,
  chain,
  checkPersistent = true,
}: Expectation): void {
  expect(frames.length, `${label}: frames were recorded`).toBeGreaterThan(10)
  const last = frames.at(-1)?.crumbs ?? []

  expect(texts(last), `${label}: final breadcrumb chain`).toEqual(chain)
  expect(
    last.map((c) => c.current),
    `${label}: aria-current=page only on the last crumb`,
  ).toEqual(chain.map((_, i) => i === chain.length - 1))

  const persistent = checkPersistent ? texts(before).filter((text) => chain.includes(text)) : []
  const leaving = before.filter((c) => !chain.includes(c.text)).length
  const problems: string[] = []
  for (const frame of frames) {
    const names = texts(frame.crumbs).filter(Boolean)
    const duplicated = names.filter((name, i) => names.indexOf(name) !== i)
    if (duplicated.length > 0)
      problems.push(`t=${frame.t}ms duplicate crumb: ${duplicated.join(', ')}`)
    if (frame.crumbs.length > chain.length + leaving) {
      problems.push(
        `t=${frame.t}ms ${frame.crumbs.length} items > ${chain.length} (path) + ${leaving} (leaving): ${names.join(' | ')}`,
      )
    }
    for (const text of persistent) {
      const crumb = frame.crumbs.find((c) => c.text === text)
      const ref = before.find((c) => c.text === text)
      if (!crumb || !ref) {
        problems.push(`t=${frame.t}ms persistent crumb «${text}» is missing (re-mounted?)`)
        continue
      }
      if (Math.abs(crumb.x - ref.x) > 1 || Math.abs(crumb.w - ref.w) > 1) {
        problems.push(
          `t=${frame.t}ms «${text}» moved: x ${ref.x.toFixed(1)}->${crumb.x.toFixed(1)}, w ${ref.w.toFixed(1)}->${crumb.w.toFixed(1)}`,
        )
      }
      if (crumb.opacity < 0.99) problems.push(`t=${frame.t}ms «${text}» opacity ${crumb.opacity}`)
    }
  }
  const unique = [...new Set(problems)]
  expect(
    unique.slice(0, 12),
    `${label}: ${problems.length} frame violations (first shown)`,
  ).toEqual([])
}

interface Fixture {
  m: E2EUser
  a: E2EUser
  token: string
  objectName: string
  taskTitle: string
  objectId: string
  taskId: string
  cleanup: () => Promise<void>
}

/** Own data; soft-deleted again at the end so the demo database stays clean. */
async function seed(): Promise<Fixture> {
  const [m, a] = await Promise.all([createUser('manager', 'crumbs'), createUser('executor', 'a')])
  const token = crypto.randomUUID().slice(0, 8)
  const objectName = `Крошки ${token}`
  const taskTitle = `Задача крошек ${token}`
  const objectId = await createObject(m, objectName, 'Адрес')
  const taskId = await createTask(m, objectId, a, taskTitle)
  const cleanup = async () => {
    const task = await m.client.rpc('delete_task', { p_task_id: taskId })
    if (task.error) throw task.error
    const object = await m.client.rpc('delete_object', { p_object_id: objectId })
    if (object.error) throw object.error
  }
  return { m, a, token, objectName, taskTitle, objectId, taskId, cleanup }
}

test.describe('breadcrumbs while navigating (reduced motion: no-preference)', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('objects -> object -> task -> back -> crumb click -> reload', async ({ page }) => {
    const f = await seed()
    const chainObject = ['Объекты', f.objectName]
    const chainTask = ['Объекты', f.objectName, f.taskTitle]
    const soft = (label: string, e: Expectation) => {
      try {
        checkTransition({ ...e, label })
      } catch (error) {
        failures.push(error instanceof Error ? error.message : label)
      }
    }
    const failures: string[] = []
    const hiddenFocus = await watchHiddenFocus(page)
    try {
      await installRecorder(page)
      await login(page, f.m)
      await openObjectsFiltered(page, f.token)
      await expect(page.getByRole('link', { name: f.objectName, exact: true })).toBeVisible()
      await expect(page.getByRole('navigation', { name: 'Навигация по страницам' })).toBeVisible()

      let before = await snapshot(page)
      let frames = await record(page, () =>
        page.getByRole('link', { name: f.objectName, exact: true }).click(),
      )
      soft('1 objects -> object', { label: '', frames, before, chain: chainObject })

      await expect(page.getByRole('link', { name: f.taskTitle, exact: true })).toBeVisible()
      before = await snapshot(page)
      frames = await record(page, () =>
        page.getByRole('link', { name: f.taskTitle, exact: true }).click(),
      )
      soft('2 object -> task', { label: '', frames, before, chain: chainTask })

      await expect(page.getByRole('heading', { level: 1, name: f.taskTitle })).toBeVisible()
      before = await snapshot(page)
      frames = await record(page, async () => {
        await page.goBack()
      })
      soft('3 task -> back', { label: '', frames, before, chain: chainObject })

      await page.goForward()
      await expect(page.getByRole('heading', { level: 1, name: f.taskTitle })).toBeVisible()
      await expect(page.getByRole('navigation', { name: 'Навигация по страницам' })).toContainText(
        f.taskTitle,
      )
      before = await snapshot(page)
      frames = await record(page, () =>
        page
          .getByRole('navigation', { name: 'Навигация по страницам' })
          .getByRole('link', { name: f.objectName, exact: true })
          .click(),
      )
      soft('4 task -> object crumb', { label: '', frames, before, chain: chainObject })

      await page.goto(`/tasks/${f.taskId}`)
      await expect(page.getByRole('heading', { level: 1, name: f.taskTitle })).toBeVisible()
      await page.evaluate(() => {
        window.sessionStorage.setItem('e2e-crumbs', '1')
      })
      await page.reload()
      await page.waitForFunction(
        () => (window as unknown as RecorderWindow).__crumbRec?.done === true,
        undefined,
        { timeout: 10_000 },
      )
      frames = await page.evaluate(
        () => (window as unknown as RecorderWindow).__crumbRec?.frames ?? [],
      )
      await page.evaluate(() => {
        window.sessionStorage.removeItem('e2e-crumbs')
      })
      const shown = frames.slice(frames.findIndex((frame) => frame.crumbs.length > 0))
      soft('5 reload task page', {
        label: '',
        frames: shown,
        before: [],
        chain: chainTask,
        checkPersistent: false,
      })
    } finally {
      await f.cleanup()
    }
    expect(failures, 'breadcrumb transitions with violations').toEqual([])
    expect(await hiddenFocus(), 'aria-hidden set on a subtree holding focus').toEqual([])
  })
})

test.describe('breadcrumbs with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('a crumb that appears does not slide in', async ({ page }) => {
    const f = await seed()
    try {
      await installRecorder(page)
      await login(page, f.m)
      await openObjectsFiltered(page, f.token)
      await expect(page.getByRole('link', { name: f.objectName, exact: true })).toBeVisible()

      const frames = await record(page, () =>
        page.getByRole('link', { name: f.objectName, exact: true }).click(),
      )
      const final = frames.at(-1)?.crumbs.find((c) => c.text === f.objectName)
      expect(final, 'the object crumb is shown at the end').toBeDefined()
      const moved = frames.flatMap((frame) => {
        const crumb = frame.crumbs.find((c) => c.text === f.objectName)
        return crumb && final && Math.abs(crumb.x - final.x) > 1
          ? [`t=${frame.t}ms x ${crumb.x.toFixed(1)} (final ${final.x.toFixed(1)})`]
          : []
      })
      expect(moved.slice(0, 8), 'the appearing crumb never changes x').toEqual([])
    } finally {
      await f.cleanup()
    }
  })

  test('task page: appearing crumbs do not slide in either', async ({ page }) => {
    const f = await seed()
    try {
      await installRecorder(page)
      await login(page, f.m)
      await page.goto(`/objects/${f.objectId}`)
      await expect(page.getByRole('link', { name: f.taskTitle, exact: true })).toBeVisible()
      const frames = await record(page, () =>
        page.getByRole('link', { name: f.taskTitle, exact: true }).click(),
      )
      const finalCrumbs = frames.at(-1)?.crumbs ?? []
      const moved = frames.flatMap((frame) =>
        frame.crumbs.flatMap((crumb) => {
          const ref = finalCrumbs.find((c) => c.text === crumb.text)
          return ref && crumb.text && Math.abs(crumb.x - ref.x) > 1
            ? [`t=${frame.t}ms «${crumb.text}» x ${crumb.x.toFixed(1)} (final ${ref.x.toFixed(1)})`]
            : []
        }),
      )
      expect([...new Set(moved)].slice(0, 8), 'no crumb changes x').toEqual([])
    } finally {
      await f.cleanup()
    }
  })
})

test.describe('breadcrumbs after F5 on a task page', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('crumb of the object keeps its text and width; leaving crumb never overlaps it', async ({
    page,
  }) => {
    const f = await seed()
    try {
      await installRecorder(page)
      await login(page, f.m)
      await page.goto(`/tasks/${f.taskId}`)
      await page.reload()
      const trail = page.getByRole('navigation', { name: 'Навигация по страницам' })
      await expect(trail).toContainText(f.taskTitle)
      await expect
        .poll(
          async () => {
            const a = await snapshot(page)
            await page.waitForFunction(() => new Promise((r) => requestAnimationFrame(r)))
            const b = await snapshot(page)
            return (
              a.length === 3 &&
              a.every((c, i) => c.opacity >= 0.99 && Math.abs(c.x - (b[i]?.x ?? -1)) < 0.5)
            )
          },
          { message: 'breadcrumbs settle after the reload', timeout: 10_000 },
        )
        .toBe(true)
      const before = await snapshot(page)
      const objectBefore = before.find((c) => c.text === f.objectName)
      expect(objectBefore, 'the object crumb is shown after F5').toBeDefined()

      const frames = await record(page, () =>
        trail.getByRole('link', { name: f.objectName, exact: true }).click(),
      )

      expect(frames.length, 'frames were recorded').toBeGreaterThan(10)
      const problems: string[] = []
      for (const frame of frames) {
        const object = frame.crumbs.find((c) => c.text === f.objectName)
        if (!object) {
          problems.push(
            `t=${frame.t}ms object crumb has no text: [${texts(frame.crumbs).join(' | ')}]`,
          )
        } else if (objectBefore && Math.abs(object.w - objectBefore.w) > 1) {
          problems.push(
            `t=${frame.t}ms object crumb width ${objectBefore.w.toFixed(1)}->${object.w.toFixed(1)}`,
          )
        }
        const items = frame.crumbs.filter((c) => c.w > 0)
        for (let i = 0; i < items.length; i++) {
          for (let j = i + 1; j < items.length; j++) {
            const p = items[i]
            const q = items[j]
            if (p && q && p.x < q.x + q.w - 1 && q.x < p.x + p.w - 1) {
              problems.push(
                `t=${frame.t}ms «${p.text}» [${p.x.toFixed(0)}..${(p.x + p.w).toFixed(0)}] overlaps «${q.text}» [${q.x.toFixed(0)}..${(q.x + q.w).toFixed(0)}]`,
              )
            }
          }
        }
      }
      expect(
        [...new Set(problems)].slice(0, 10),
        `${String(problems.length)} frame violations after F5 -> object crumb`,
      ).toEqual([])
    } finally {
      await f.cleanup()
    }
  })
})
