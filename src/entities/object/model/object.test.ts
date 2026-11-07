import { describe, expect, it } from 'vitest'

import { DEFAULT_OBJECT_SORT, pickObjectSort } from './object'

describe('pickObjectSort', () => {
  it('keeps allowed ids with their direction', () => {
    expect(pickObjectSort({ id: 'name', desc: true })).toEqual({ id: 'name', desc: true })
    expect(pickObjectSort({ id: 'address', desc: false })).toEqual({ id: 'address', desc: false })
  })

  it('falls back to the default for unknown ids and undefined', () => {
    expect(pickObjectSort({ id: 'created_at', desc: true })).toEqual(DEFAULT_OBJECT_SORT)
    expect(pickObjectSort({ id: 'deleted_at', desc: false })).toEqual(DEFAULT_OBJECT_SORT)
    expect(pickObjectSort({ id: '', desc: true })).toEqual(DEFAULT_OBJECT_SORT)
    expect(pickObjectSort(undefined)).toEqual(DEFAULT_OBJECT_SORT)
    expect(DEFAULT_OBJECT_SORT).toEqual({ id: 'name', desc: false })
  })
})
