import axe from 'axe-core'
import { expect } from 'vitest'

/** Runs axe-core in jsdom. Colour contrast needs real layout, so it is checked in Playwright instead. */
export async function expectNoAxeViolations(container: Element): Promise<void> {
  const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
  const summary = result.violations.map((v) => `${v.id} (${v.impact ?? 'n/a'}): ${v.help}`)
  expect(summary).toEqual([])
}
