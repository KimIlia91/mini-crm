/// <reference lib="dom" />
import { expect, type Locator, type Page } from '@playwright/test'

import { expectNoA11yViolations, settleAnimations } from './fixtures'

export const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
] as const

export type Viewport = (typeof VIEWPORTS)[number]

const LONG_WORD = 'Сверхдлинноенаименованиебезпробеловдляпроверкипереноса'.padEnd(60, 'а')

export const LONG = {
  word: LONG_WORD,
  objectName: `${LONG_WORD} ${'Название '.repeat(30)}`.slice(0, 200).trim(),
  address: `${LONG_WORD}, ${'ул. Очень Длинная, д. 1, '.repeat(30)}`.slice(0, 500).trim(),
  taskTitle: `${LONG_WORD} ${'Задача '.repeat(40)}`.slice(0, 200).trim(),
  description: Array.from(
    { length: 20 },
    (_, i) => `Строка ${i + 1}: ${LONG_WORD} ${'описание '.repeat(8)}`,
  )
    .join('\n')
    .slice(0, 2000),
  comment: Array.from({ length: 5 }, () => `${LONG_WORD} ${'правки '.repeat(25)}`)
    .join('\n')
    .slice(0, 1000),
  /** 60 chars without spaces: used as a user label (full name / header). */
  userLabel: 'LongNameWithoutSpacesLongNameWithoutSpacesLongNameWithout1'.slice(0, 60),
}

/** Runs inside the page; returns human-readable violations for the current DOM. */
function collectInvariantViolations(allowToastOverlay: boolean): string[] {
  const out: string[] = []
  const vw = document.documentElement.clientWidth
  const vh = window.innerHeight
  const describe = (el: Element): string => {
    const text = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40)
    const label = el.getAttribute('aria-label')
    const cls = (el.getAttribute('class') ?? '').slice(0, 50)
    return `<${el.tagName.toLowerCase()}${el.getAttribute('role') ? ` role=${el.getAttribute('role')}` : ''}${
      label ? ` aria-label="${label.slice(0, 40)}"` : ''
    }${cls ? ` class="${cls}"` : ''}> "${text}"`
  }
  const isVisible = (el: Element): boolean => {
    const r = el.getBoundingClientRect()
    if (r.width <= 1 && r.height <= 1) return false // sr-only and friends
    if (el.closest('.sr-only')) return false // visually hidden on purpose (even with padding)
    const s = getComputedStyle(el)
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'
  }
  const dialogs = Array.from(document.querySelectorAll('[role=dialog], [role=alertdialog]')).filter(
    isVisible,
  )
  // An open menu (row actions, filter, profile) overlays the page on purpose, like a dialog.
  const menus = Array.from(document.querySelectorAll('[role=menu]')).filter(isVisible)
  for (const menu of menus) {
    const r = menu.getBoundingClientRect()
    if (r.left < -0.5 || r.right > vw + 0.5) {
      out.push(
        `menu wider than viewport: ${describe(menu)} left=${r.left} right=${r.right} vw=${vw}`,
      )
    }
  }

  // 1. No horizontal page scroll.
  const root = document.documentElement
  if (root.scrollWidth > root.clientWidth) {
    const offenders = Array.from(document.body.querySelectorAll('*'))
      .filter((el) => isVisible(el) && el.getBoundingClientRect().right > vw + 1)
      .filter((el) => !el.closest('[data-radix-popper-content-wrapper]'))
      .slice(0, 5)
      .map((el) => `${describe(el)} right=${Math.round(el.getBoundingClientRect().right)}`)
    out.push(
      `horizontal page scroll: scrollWidth ${root.scrollWidth} > clientWidth ${root.clientWidth}; widest: ${offenders.join(' | ')}`,
    )
  }

  // 2. Dialogs fit the viewport and their content is reachable.
  for (const dialog of dialogs) {
    const r = dialog.getBoundingClientRect()
    if (r.left < -0.5 || r.right > vw + 0.5) {
      out.push(
        `dialog wider than viewport: ${describe(dialog)} left=${r.left} right=${r.right} vw=${vw}`,
      )
    }
    if (r.top < -0.5 || r.bottom > vh + 0.5) {
      out.push(
        `dialog taller than viewport: ${describe(dialog)} top=${Math.round(r.top)} bottom=${Math.round(r.bottom)} vh=${vh}`,
      )
    }
    const isScroller = (el: Element) => {
      const oy = getComputedStyle(el).overflowY
      return oy === 'auto' || oy === 'scroll'
    }
    for (const el of dialog.querySelectorAll('*')) {
      if (!isVisible(el)) continue
      const er = el.getBoundingClientRect()
      if (er.bottom <= r.bottom + 1 && er.top >= r.top - 1) continue
      let scrollable = false
      for (let p: Element | null = el.parentElement; p; p = p.parentElement) {
        if (isScroller(p)) {
          scrollable = true
          break
        }
        if (p === dialog) break
      }
      if (!scrollable) {
        out.push(
          `dialog content outside dialog and not scrollable: ${describe(el)} (dialog ${describe(dialog)})`,
        )
        break
      }
    }
  }

  // 3. Clipped (not intentionally truncated) text.
  const textSelector = 'h1,h2,h3,h4,p,li,td,th,dd,dt,button,a,label,span,[data-slot]'
  for (const el of document.querySelectorAll(textSelector)) {
    if (!isVisible(el)) continue
    const s = getComputedStyle(el)
    const clips = ['hidden', 'clip'].includes(s.overflowX)
    if (!clips || el.scrollWidth <= el.clientWidth + 1) continue
    if (!el.textContent.trim()) continue
    // A label collapsed to zero width on purpose (icon-only sidebar) has nothing visible to clip.
    if (el.clientWidth === 0) continue
    if (el.children.length > 0) {
      const box = el.getBoundingClientRect()
      const collapsedAway = (node: Element): boolean => {
        for (let p: Element | null = node; p && p !== el; p = p.parentElement) {
          if (p.clientWidth === 0) return true
        }
        return false
      }
      const overflowing = Array.from(el.querySelectorAll('*')).filter(
        (d) =>
          d.textContent.trim() &&
          d.getBoundingClientRect().right > box.right + 1 &&
          !collapsedAway(d),
      )
      if (overflowing.length === 0) continue
    }
    if (s.textOverflow === 'ellipsis' && el.getAttribute('title')) continue
    out.push(
      `text clipped (${s.textOverflow === 'ellipsis' ? 'ellipsis without title' : 'overflow hidden'}): ${describe(el)} scrollWidth=${el.scrollWidth} clientWidth=${el.clientWidth}`,
    )
  }

  // 4. Interactive targets: size and not covered.
  const scrollY = window.scrollY
  const interactive = Array.from(
    document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea'),
  ).filter(isVisible)
  for (const el of interactive) {
    const r = el.getBoundingClientRect()
    if (r.width < 24 || r.height < 24) {
      out.push(
        `target smaller than 24x24 (${Math.round(r.width)}x${Math.round(r.height)}): ${describe(el)}`,
      )
    }
    // With an open modal the page behind it is inert and covered on purpose.
    if (dialogs.length > 0 && !dialogs.some((d) => d.contains(el))) continue
    if (menus.length > 0 && !menus.some((m) => m.contains(el))) continue
    el.scrollIntoView({ block: 'center', inline: 'nearest' })
    const c = el.getBoundingClientRect()
    const top = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2)
    // Only with allowToastOverlay (toast cases): a toast is a transient, dismissible overlay, so content
    // under it is covered on purpose. Anywhere else a toast covering a target still fails.
    const underToast =
      allowToastOverlay &&
      top?.closest('[data-sonner-toaster]') != null &&
      !el.closest('[data-sonner-toaster]')
    const ok =
      underToast ||
      (top !== null &&
        (top === el ||
          el.contains(top) ||
          (top.contains(el) && top !== document.body && top !== document.documentElement) ||
          top.closest<HTMLLabelElement>('label')?.control === el))
    if (!ok) {
      out.push(
        `${top ? `target covered at its center by ${describe(top)}` : 'target unreachable (center outside the viewport, not scrollable into view)'}: ${describe(el)}`,
      )
    }
  }
  window.scrollTo(0, scrollY)
  return out
}

export interface SnapOptions {
  screen: string
  state: string
  viewport: { width: number; height: number }
  /** Run axe too (every key page and every dialog state). */
  axe?: boolean
  /** Toast cases only: do not report page content that the shown toast covers. Off by default. */
  allowToastOverlay?: boolean
}

/**
 * Screenshots the current state (artifact, not a baseline) and records invariant + axe violations as
 * soft failures, so every viewport and state of a scenario is evaluated before the test fails.
 */
export async function auditState(page: Page, opts: SnapOptions): Promise<void> {
  await settleAnimations(page)
  const name = `${opts.screen}-${opts.state}-${opts.viewport.width}`
  const where = `[${opts.screen} / ${opts.state} @ ${opts.viewport.width}x${opts.viewport.height}] screenshot test-results/layout/${name}.png`
  await page.screenshot({ path: `test-results/layout/${name}.png`, fullPage: true })
  const violations = await page.evaluate(
    collectInvariantViolations,
    opts.allowToastOverlay ?? false,
  )
  if (opts.axe !== false) {
    try {
      await expectNoA11yViolations(page)
    } catch (error) {
      violations.push(
        // First line: rule and node count; next lines: the offending nodes (to diagnose rare flakes).
        `axe: ${error instanceof Error ? error.message.split('\n').slice(0, 4).join(' ⏎ ') : String(error)}`,
      )
    }
  }
  expect.soft(violations, `${where}\n`).toEqual([])
}

export async function resize(page: Page, viewport: Viewport): Promise<void> {
  await page.setViewportSize(viewport)
}

/** Focus must be inside the dialog right after it opens. */
export async function expectFocusInside(dialog: Locator, where: string): Promise<void> {
  await expect
    .soft(async () => {
      const inside = await dialog.evaluate((el) => el.contains(document.activeElement))
      expect(inside, `${where}: focus is not inside the dialog after opening`).toBe(true)
    })
    .toPass({ timeout: 3_000 })
}

/** Escape closes a non-destructive dialog and returns focus to its trigger. */
export async function expectEscapeClosesAndRestoresFocus(
  page: Page,
  dialog: Locator,
  trigger: Locator,
  where: string,
): Promise<void> {
  await page.keyboard.press('Escape')
  await expect.soft(dialog, `${where}: Escape did not close the dialog`).toBeHidden()
  await expect.soft(trigger, `${where}: focus did not return to the trigger`).toBeFocused()
}
