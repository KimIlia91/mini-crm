import { describe, expect, it } from 'vitest'

import { formatDateTime, formatDateTimeFull } from './format-date-time'

describe('formatDateTimeFull', () => {
  it('includes the month name and seconds', () => {
    expect(formatDateTimeFull('2026-11-06T12:05:09Z')).toMatch(/2026.*\d{2}:\d{2}:\d{2}/)
    expect(formatDateTimeFull('2026-11-06T12:05:09Z')).toContain('ноября')
  })
})

describe('formatDateTime', () => {
  it('formats ISO strings and Dates in ru-RU day.month.year order', () => {
    const iso = '2026-11-06T12:05:00Z'
    expect(formatDateTime(iso)).toMatch(/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/)
    expect(formatDateTime(new Date(iso))).toBe(formatDateTime(iso))
  })
})
