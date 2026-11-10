import { createObject, createTask, createUser, expect, login, test } from './fixtures'

declare global {
  interface Window {
    __cspViolations?: string[]
  }
}

test.describe('security headers', () => {
  test('the preview serves the CSP and the baseline headers', async ({ request, supabaseUrl }) => {
    const response = await request.get('/')
    const headers = response.headers()
    const origin = new URL(supabaseUrl).origin
    const csp = headers['content-security-policy'] ?? ''

    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self';")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain(`connect-src 'self' ${origin} ${origin.replace(/^http/, 'ws')};`)
    expect(csp).not.toContain('.supabase.co')
    expect(csp).not.toContain('upgrade-insecure-requests')
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['permissions-policy']).toContain('camera=()')
    expect(headers['x-frame-options']).toBe('DENY')
  })

  test('the stored dark theme is applied before the first paint', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('mini-crm-theme', 'dark')
      document.addEventListener('DOMContentLoaded', () => {
        window.sessionStorage.setItem(
          'dark-at-dcl',
          String(document.documentElement.classList.contains('dark')),
        )
      })
    })
    await page.goto('/login')
    await expect(page.locator('html')).toHaveClass(/dark/)
    expect(await page.evaluate(() => window.sessionStorage.getItem('dark-at-dcl'))).toBe('true')
  })

  test('main screens run without CSP violations', async ({ page }) => {
    const manager = await createUser('manager', 'csp-manager')
    const executor = await createUser('executor', 'csp-executor')
    const objectId = await createObject(manager, `CSP объект ${crypto.randomUUID().slice(0, 8)}`)
    const taskId = await createTask(manager, objectId, executor, 'CSP задача')

    const consoleProblems: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        consoleProblems.push(message.text())
      }
    })
    await page.addInitScript(() => {
      window.__cspViolations = []
      document.addEventListener('securitypolicyviolation', (event) => {
        window.__cspViolations?.push(
          `${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}:${event.lineNumber} ${event.sample}`,
        )
      })
    })

    await login(page, manager)
    const violations: string[] = await page.evaluate(() => window.__cspViolations ?? [])
    const paths = ['/objects', `/objects/${objectId}`, `/tasks/${taskId}`, '/board', '/about']
    for (const path of paths) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      violations.push(...(await page.evaluate(() => window.__cspViolations ?? [])))
    }
    await expect(page.locator('video')).toBeAttached()

    expect(violations).toEqual([])
    expect(consoleProblems.filter((text) => /content security policy/i.test(text))).toEqual([])
  })
})
