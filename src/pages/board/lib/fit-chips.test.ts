import { describe, expect, it } from 'vitest'

import { fitChipCount } from './fit-chips'

describe('fitChipCount', () => {
  it('shows every chip when all of them fit, without room for «+N»', () => {
    expect(fitChipCount({ widths: [50, 50, 50], available: 162, gap: 6, moreWidth: 40 })).toBe(3)
  })

  it('reserves room for «+N» once a chip has to be hidden', () => {
    expect(fitChipCount({ widths: [50, 50, 50], available: 161, gap: 6, moreWidth: 40 })).toBe(2)
    expect(fitChipCount({ widths: [50, 50, 50], available: 152, gap: 6, moreWidth: 40 })).toBe(2)
    expect(fitChipCount({ widths: [50, 50, 50], available: 151, gap: 6, moreWidth: 40 })).toBe(1)
  })

  it('keeps chips of different widths in their order', () => {
    expect(fitChipCount({ widths: [30, 120, 30], available: 120, gap: 6, moreWidth: 40 })).toBe(1)
  })

  it('hides every chip when not even one fits next to «+N»', () => {
    expect(fitChipCount({ widths: [160, 160], available: 100, gap: 6, moreWidth: 40 })).toBe(0)
  })

  it('returns 0 for no chips', () => {
    expect(fitChipCount({ widths: [], available: 500, gap: 6, moreWidth: 40 })).toBe(0)
  })
})
