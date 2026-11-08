import type { Browser, Locator, Page } from '@playwright/test'

import { blockRealtime, expect, test } from './fixtures'

/** Below this width the sidebar is a sheet opened with the header button (md breakpoint of the app). */
const SIDEBAR_SHEET_MAX_WIDTH = 768

export const NAV_LABEL = 'Основная навигация'
export const SIDEBAR_TOGGLE = 'Переключить боковую панель'

export const mainNav = (page: Page): Locator => page.getByRole('navigation', { name: NAV_LABEL })

/** A fresh browser context with the same device settings as the current project (desktop / mobile). */
export async function newUserPage(
  browser: Browser,
  { live = false }: { live?: boolean } = {},
): Promise<Page> {
  const { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } =
    test.info().project.use
  const context = await browser.newContext({
    ...(baseURL ? { baseURL } : {}),
    ...(viewport !== undefined ? { viewport } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(deviceScaleFactor ? { deviceScaleFactor } : {}),
    ...(isMobile !== undefined ? { isMobile } : {}),
    ...(hasTouch !== undefined ? { hasTouch } : {}),
  })
  if (!live) await blockRealtime(context)
  return context.newPage()
}

export function usesSidebarSheet(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < SIDEBAR_SHEET_MAX_WIDTH
}

/** Clicks a sidebar link, opening the mobile sheet first when the sidebar is not permanently shown. */
export async function goToSection(page: Page, name: 'Объекты' | 'Мои задачи'): Promise<void> {
  if (usesSidebarSheet(page)) {
    await page.getByRole('button', { name: SIDEBAR_TOGGLE }).click()
  }
  await mainNav(page).getByRole('link', { name, exact: true }).click()
}

/** Header avatar button (accessible name «Меню пользователя: <имя>»). */
export const profileButton = (page: Page): Locator =>
  page.getByRole('button', { name: /^Меню пользователя: / })

/** Signs out through the profile menu and the confirmation dialog. */
export async function signOut(page: Page): Promise<void> {
  await profileButton(page).click()
  await page.getByRole('menuitem', { name: 'Выйти' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Выйти из аккаунта?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page).toHaveURL(/\/login/)
}

/** Table rows are `row`s; the header row is excluded by requiring the row to contain the link. */
export const rowWithLink = (page: Page, name: string): Locator =>
  page.getByRole('row').filter({ has: page.getByRole('link', { name, exact: true }) })

/** Status badge in the page header (first in DOM order; the history timeline repeats statuses). */
export const headerStatus = (page: Page, status: string): Locator =>
  page.getByText(status, { exact: true }).first()

/** Opens the objects list filtered to `query` (search state lives in the URL, 10 rows per page). */
export async function openObjectsFiltered(page: Page, query: string): Promise<void> {
  await page.goto(`/objects?q=${encodeURIComponent(query)}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Объекты' })).toBeVisible()
}

/** Dark theme is stored in localStorage and applied by the ThemeProvider at startup. */
export async function useDarkTheme(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('mini-crm-theme', 'dark')
  })
}
