/// <reference lib="dom" />
import type { Locator, Page } from '@playwright/test'

import { profileButton, useDarkTheme } from './app-helpers'
import { createObject, createUser, expect, expectNoA11yViolations, login, test } from './fixtures'
import { auditState, resize, VIEWPORTS } from './layout-helpers'

// Public page /about (T-027): entry points, no data requests, lazy video, assets, layout, keyboard, a11y.
// Playback itself is not tested: Playwright Chromium has no H.264 decoder (checked manually in Chrome/Edge).

const uid = () => crypto.randomUUID().slice(0, 8)

const POSTER = '/media/mini-crm-demo-poster.jpg'
const MP4 = '/media/mini-crm-demo.mp4'
const VTT = '/media/mini-crm-demo.ru.vtt'

const h1 = (page: Page) => page.getByRole('heading', { level: 1, name: 'О проекте' })
const video = (page: Page) => page.getByLabel('Видео-обзор Mini-CRM')
const aboutLink = (page: Page) => page.getByRole('link', { name: 'О проекте', exact: true })

/** Opens «О проекте» from the header user menu. */
async function openAboutFromMenu(page: Page, trigger: Locator): Promise<void> {
  await trigger.click()
  await page.getByRole('menuitem', { name: 'О проекте' }).click()
  await expect(page).toHaveURL(/\/about$/)
  await expect(h1(page)).toBeVisible()
}

/** Collects URLs of all requests of a page (until the page is closed). */
function trackRequests(page: Page): string[] {
  const urls: string[] = []
  page.on('request', (request) => urls.push(request.url()))
  return urls
}

test.describe('entry points and navigation', () => {
  test('signed out: login -> О проекте -> Войти -> login', async ({ page }) => {
    await page.goto('/login')
    await aboutLink(page).click()
    await expect(page).toHaveURL(/\/about$/)
    await expect(h1(page)).toBeVisible()
    await expect(page.getByRole('link', { name: 'К приложению' })).toHaveCount(0)
    await page.getByRole('link', { name: 'Войти', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
  })

  test('manager: user menu -> О проекте -> К приложению -> objects; Back returns', async ({
    page,
  }) => {
    const m = await createUser('manager', 'm')
    await login(page, m)
    await expect(page).toHaveURL(/\/objects$/)

    await openAboutFromMenu(page, profileButton(page))
    await expect(page.getByRole('link', { name: 'Войти', exact: true })).toHaveCount(0)
    await page.goBack()
    await expect(page).toHaveURL(/\/objects$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Объекты' })).toBeVisible()

    await openAboutFromMenu(page, profileButton(page))
    await page.getByRole('link', { name: 'К приложению' }).click()
    await expect(page).toHaveURL(/\/objects$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Объекты' })).toBeVisible()
  })

  test('executor: user menu (sidebar footer on desktop) -> О проекте -> К приложению -> my tasks', async ({
    page,
  }) => {
    const a = await createUser('executor', 'a')
    await login(page, a)
    await expect(page).toHaveURL(/\/my-tasks$/)

    const isDesktop = (page.viewportSize()?.width ?? 0) >= 768
    const trigger = isDesktop
      ? // Sidebar footer trigger: the name starts with the user's name, the header avatar says «Меню пользователя: …».
        page.getByRole('button', { name: a.fullName }).filter({ hasNotText: 'Меню пользователя' })
      : profileButton(page)
    await openAboutFromMenu(page, trigger)
    await page.getByRole('link', { name: 'К приложению' }).click()
    await expect(page).toHaveURL(/\/my-tasks$/)
  })

  test('user who must change the password: /about is visible, К приложению -> change password', async ({
    page,
  }) => {
    const newbie = await createUser('executor', 'newbie', { active: false })
    await login(page, newbie, { expectSuccess: false })
    await expect(page).toHaveURL(/\/change-password$/)

    await page.goto('/about')
    await expect(page).toHaveURL(/\/about$/)
    await expect(h1(page)).toBeVisible()
    await page.getByRole('link', { name: 'К приложению' }).click()
    await expect(page).toHaveURL(/\/change-password$/)
  })

  test('Pixel 7: a scrolled list -> menu -> О проекте opens at the top', async ({ page }) => {
    test.skip(
      test.info().project.name !== 'chromium-mobile',
      'scroll restoration scenario for the mobile layout',
    )
    const m = await createUser('manager', 'm')
    const token = uid()
    for (let i = 0; i < 12; i++) await createObject(m, `Объект ${token} ${String(i)}`)
    await login(page, m)
    await page.goto('/objects')
    await expect(page.getByRole('heading', { level: 1, name: 'Объекты' })).toBeVisible()
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight)
    })
    await openAboutFromMenu(page, profileButton(page))
    await expect(h1(page)).toBeInViewport()
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  })
})

test.describe('no data requests and lazy video', () => {
  test('opening /about makes no /rest/v1/ requests, signed out and signed in', async ({ page }) => {
    const m = await createUser('manager', 'm')
    const signedOut = trackRequests(page)
    await page.goto('/about')
    await expect(h1(page)).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(signedOut.filter((u) => u.includes('/rest/v1/'))).toEqual([])

    await login(page, m)
    const signedIn = trackRequests(page)
    await page.goto('/about')
    await expect(h1(page)).toBeVisible()
    await expect(page.getByRole('link', { name: 'К приложению' })).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(signedIn.filter((u) => u.includes('/rest/v1/'))).toEqual([])
  })

  test('video is not downloaded before play; the poster is', async ({ page }) => {
    const urls = trackRequests(page)
    await page.goto('/about')
    await expect(video(page)).toBeVisible()
    await page.waitForLoadState('networkidle')

    expect(
      urls.some((u) => u.includes(POSTER)),
      'poster is requested',
    ).toBe(true)
    expect(urls.filter((u) => u.endsWith('.mp4') || u.endsWith('.vtt'))).toEqual([])

    const state = await video(page).evaluate((el: HTMLVideoElement) => ({
      paused: el.paused,
      autoplay: el.autoplay,
      muted: el.hasAttribute('muted'),
      loop: el.loop,
      preload: el.preload,
      readyState: el.readyState,
      controls: el.controls,
      tracks: Array.from(el.querySelectorAll('track')).map((t) => ({
        kind: t.kind,
        srclang: t.srclang,
        isDefault: t.hasAttribute('default'),
      })),
    }))
    expect(state).toMatchObject({
      paused: true,
      autoplay: false,
      muted: false,
      loop: false,
      preload: 'none',
      readyState: 0,
      controls: true,
    })
    expect(state.tracks).toEqual([{ kind: 'captions', srclang: 'ru', isDefault: false }])
  })

  test('served assets: vtt, mp4 range, poster', async ({ request }) => {
    const vtt = await request.get(VTT)
    expect(vtt.status()).toBe(200)
    expect(await vtt.text()).toMatch(/^WEBVTT/)

    const mp4 = await request.get(MP4, { headers: { Range: 'bytes=0-1' } })
    expect([200, 206]).toContain(mp4.status())
    expect(mp4.headers()['content-type']).toContain('video/mp4')

    const poster = await request.get(POSTER)
    expect(poster.status()).toBe(200)
    expect(poster.headers()['content-type']).toContain('image/jpeg')
  })
})

test.describe('layout', () => {
  test('no overflow, 16:9 stable video, header does not collide (320/375/768/1280)', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'viewports are set explicitly')
    test.setTimeout(120_000)
    const m = await createUser('manager', 'm')

    async function check(state: 'signed-out' | 'signed-in', actionName: string) {
      for (const vp of VIEWPORTS) {
        await resize(page, vp)
        await page.goto('/about')
        await expect(h1(page)).toBeVisible()
        await expect(video(page)).toBeVisible()
        const where = `${state} @ ${String(vp.width)}`

        const before = await video(page).boundingBox()
        // Wait for the poster so a late image cannot change the box.
        await page.waitForLoadState('networkidle')
        const after = await video(page).boundingBox()
        if (!before || !after) throw new Error(`${where}: video has no box`)
        expect(after.width, `${where}: width changed after the poster loaded`).toBeCloseTo(
          before.width,
          0,
        )
        expect(after.height, `${where}: height changed after the poster loaded`).toBeCloseTo(
          before.height,
          0,
        )
        expect(after.width, `${where}: video wider than viewport`).toBeLessThanOrEqual(vp.width)
        expect(after.width / after.height, `${where}: not 16:9`).toBeCloseTo(16 / 9, 1)

        const scrolls = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        )
        expect(scrolls, `${where}: horizontal page scroll`).toBe(false)

        const banner = page.getByRole('banner')
        const brand = await banner.getByText('Mini-CRM', { exact: true }).boundingBox()
        const action = await banner.getByRole('link', { name: actionName }).boundingBox()
        if (!brand || !action) throw new Error(`${where}: header parts have no box`)
        const overlap =
          brand.x < action.x + action.width &&
          action.x < brand.x + brand.width &&
          brand.y < action.y + action.height &&
          action.y < brand.y + brand.height
        expect(overlap, `${where}: brand and action overlap`).toBe(false)

        await auditState(page, { screen: 'about', state, viewport: vp })
      }
    }

    await check('signed-out', 'Войти')
    await login(page, m)
    await check('signed-in', 'К приложению')
  })

  test('zoom 200% and text spacing keep the page without horizontal scroll', async ({ page }) => {
    const viewport = page.viewportSize() ?? { width: 1280, height: 720 }
    const ZOOM = 'html { font-size: 200% !important; }'
    const SPACING =
      '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }'
    for (const [state, css] of [
      ['zoom200', ZOOM],
      ['text-spacing', SPACING],
      ['zoom200-and-spacing', `${ZOOM} ${SPACING}`],
    ] as const) {
      await page.goto('/about')
      await expect(h1(page)).toBeVisible()
      await page.addStyleTag({ content: css })
      await auditState(page, { screen: 'about', state, viewport, axe: false })
    }
  })
})

test.describe('keyboard', () => {
  async function tabTo(page: Page, target: Locator, maxTabs = 40): Promise<void> {
    await expect(target).toBeVisible()
    for (let i = 0; i < maxTabs; i++) {
      await page.keyboard.press('Tab')
      const focused = await target
        .evaluate((el) => el === document.activeElement, undefined, { timeout: 1_000 })
        .catch(() => false)
      if (focused) return
    }
    throw new Error(`${target.toString()} is not reachable with Tab`)
  }

  test('skip link first, header action and video reachable', async ({ page }) => {
    await page.goto('/about')
    await expect(h1(page)).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'К содержимому' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('main')).toBeFocused()

    await page.reload()
    await expect(h1(page)).toBeVisible()
    await tabTo(page, page.getByRole('link', { name: 'Войти', exact: true }))
    await tabTo(page, video(page))
  })

  test('menu item «О проекте» is reachable with arrows and opens with Enter', async ({ page }) => {
    const m = await createUser('manager', 'm')
    await login(page, m)
    await expect(page).toHaveURL(/\/objects$/)
    const trigger = profileButton(page)
    await trigger.focus()
    await page.keyboard.press('Enter')
    const item = page.getByRole('menuitem', { name: 'О проекте' })
    await expect(item).toBeVisible()
    for (let i = 0; i < 10; i++) {
      if (await item.evaluate((el) => el === document.activeElement)) break
      await page.keyboard.press('ArrowDown')
    }
    await expect(item).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/about$/)
    await expect(h1(page)).toBeVisible()
  })
})

test.describe('structure and accessibility', () => {
  test('landmarks, one h1, no skipped heading levels, expected sections', async ({ page }) => {
    await page.goto('/about')
    await expect(h1(page)).toBeVisible()
    await expect(page.getByRole('banner')).toHaveCount(1)
    await expect(page.getByRole('main')).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page).toHaveTitle('О проекте — Mini-CRM')

    const levels = await page
      .getByRole('heading')
      .evaluateAll((els) => els.map((el) => Number(el.tagName[1])))
    expect(levels[0]).toBe(1)
    levels.forEach((level, index) => {
      expect(level, `heading levels ${levels.join(',')}`).toBeLessThanOrEqual(
        (levels[index - 1] ?? 0) + 1,
      )
    })
    const h2 = await page.getByRole('heading', { level: 2 }).allTextContents()
    expect(h2).toEqual([
      'Видео-обзор',
      'Роли',
      'Путь задачи',
      'Как работать',
      'Как устроено',
      'Как защищены данные',
      'Решения и допущения',
    ])
  })

  test('axe in the light theme, signed out and signed in', async ({ page }) => {
    const m = await createUser('manager', 'm')
    await page.goto('/about')
    await expect(h1(page)).toBeVisible()
    await expectNoA11yViolations(page)

    await login(page, m)
    await page.goto('/about')
    await expect(page.getByRole('link', { name: 'К приложению' })).toBeVisible()
    await expectNoA11yViolations(page)
  })

  test('axe in the dark theme, signed out and signed in; dark screenshots', async ({ page }) => {
    await useDarkTheme(page)
    const m = await createUser('manager', 'm')
    await page.goto('/about')
    await expect(h1(page)).toBeVisible()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expectNoA11yViolations(page)
    for (const vp of [VIEWPORTS[0], VIEWPORTS[3]]) {
      await resize(page, vp)
      await auditState(page, { screen: 'about', state: 'dark-signed-out', viewport: vp })
    }

    await login(page, m)
    await page.goto('/about')
    await expect(page.getByRole('link', { name: 'К приложению' })).toBeVisible()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expectNoA11yViolations(page)
  })
})
