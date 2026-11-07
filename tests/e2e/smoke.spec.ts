import { expect, expectNoA11yViolations, test } from './fixtures'

test.describe('infrastructure smoke', () => {
  test('login page renders and has no serious accessibility violations', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto('/login')
    await expect(page.getByRole('heading', { level: 1, name: 'Вход в Mini-CRM' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Войти' })).toBeEnabled()
    await expectNoA11yViolations(page)
    expect(errors).toEqual([])
  })

  test('local Supabase Auth is reachable with the client key', async ({
    request,
    supabaseUrl,
    supabasePublishableKey,
  }) => {
    const res = await request.get(`${supabaseUrl}/auth/v1/health`, {
      headers: { apikey: supabasePublishableKey },
    })
    expect(res.ok()).toBe(true)
  })

  test('unknown routes do not crash the app', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('/definitely-missing-route')
    await expect(page.getByRole('heading', { name: 'Страница не найдена' })).toBeVisible()
    await page.getByRole('link', { name: 'На главную' }).click()
    await expect(page).toHaveURL(/\/login$/)
    expect(errors).toEqual([])
  })
})
