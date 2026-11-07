import { PostgrestError } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import {
  ilikeContains,
  isRangeNotSatisfiable,
  normalizeSearch,
  pageRange,
  quoteFilterValue,
  readPage,
} from './postgrest-filter'

describe('normalizeSearch', () => {
  it('trims and caps at 100 characters', () => {
    expect(normalizeSearch('  склад  ')).toBe('склад')
    expect(normalizeSearch('a'.repeat(150))).toHaveLength(100)
    expect(normalizeSearch('   ')).toBe('')
  })
})

describe('ilikeContains', () => {
  it('wraps the text in wildcards', () => {
    expect(ilikeContains('склад')).toBe('*склад*')
  })

  it('escapes LIKE metacharacters so they match literally', () => {
    expect(ilikeContains('50%')).toBe(String.raw`*50\%*`)
    expect(ilikeContains('a_b')).toBe(String.raw`*a\_b*`)
    expect(ilikeContains(String.raw`back\slash`)).toBe(String.raw`*back\\slash*`)
  })

  it('maps a star (a wildcard that cannot be escaped) to a single-character wildcard', () => {
    expect(ilikeContains('a*b')).toBe('*a_b*')
  })
})

describe('quoteFilterValue', () => {
  it('quotes the value and doubles backslashes inside or()', () => {
    expect(quoteFilterValue(String.raw`*50\%*`)).toBe(String.raw`"*50\\%*"`)
  })

  it('escapes double quotes and keeps , ( ) : literal', () => {
    expect(quoteFilterValue('x",a:(b)')).toBe(String.raw`"x\",a:(b)"`)
  })
})

describe('isRangeNotSatisfiable', () => {
  it('is true only for PGRST103', () => {
    expect(isRangeNotSatisfiable({ code: 'PGRST103' })).toBe(true)
    expect(isRangeNotSatisfiable({ code: '42501' })).toBe(false)
    expect(isRangeNotSatisfiable({})).toBe(false)
  })
})

describe('pageRange', () => {
  it('returns the inclusive window', () => {
    expect(pageRange({ pageIndex: 0, pageSize: 10 })).toEqual([0, 9])
    expect(pageRange({ pageIndex: 2, pageSize: 20 })).toEqual([40, 59])
  })

  it.each([
    [-1, 10],
    [1.5, 10],
    [0, 0],
    [0, 101],
    [0, 2.5],
  ])('rejects pageIndex=%s pageSize=%s', (pageIndex, pageSize) => {
    expect(() => pageRange({ pageIndex, pageSize })).toThrow(RangeError)
  })
})

describe('readPage', () => {
  const failure = (code: string) =>
    new PostgrestError({ message: 'x', details: '', hint: '', code })

  it('returns the rows and the exact total', async () => {
    const result = await readPage(
      () => Promise.resolve({ data: [1, 2], error: null, count: 7 }),
      () => Promise.reject(new Error('not needed')),
    )
    expect(result).toEqual({ rows: [1, 2], total: 7 })
  })

  it('on a page beyond the end reads the total without a range and returns no rows', async () => {
    const result = await readPage<number>(
      () => Promise.resolve({ data: null, error: failure('PGRST103'), count: null }),
      () => Promise.resolve({ error: null, count: 12 }),
    )
    expect(result).toEqual({ rows: [], total: 12 })
  })

  it('throws any other error', async () => {
    await expect(
      readPage<number>(
        () => Promise.resolve({ data: null, error: failure('42501'), count: null }),
        () => Promise.resolve({ error: null, count: 0 }),
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('throws when the recovery count fails', async () => {
    await expect(
      readPage<number>(
        () => Promise.resolve({ data: null, error: failure('PGRST103'), count: null }),
        () => Promise.resolve({ error: failure('XX000'), count: null }),
      ),
    ).rejects.toMatchObject({ code: 'XX000' })
  })
})
