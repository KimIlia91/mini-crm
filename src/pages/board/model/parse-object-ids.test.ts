import { describe, expect, it } from 'vitest'

import { MAX_BOARD_OBJECTS, parseObjectIds } from './board'

const IDS = Array.from({ length: 12 }, () => crypto.randomUUID())
const id = (index: number) => IDS[index] ?? ''

describe('parseObjectIds', () => {
  it('keeps valid ids in URL order', () => {
    expect(parseObjectIds([id(2), id(0), id(1)])).toEqual([id(2), id(0), id(1)])
  })

  it('returns an empty list for no values', () => {
    expect(parseObjectIds([])).toEqual([])
  })

  it('drops invalid values and keeps the valid ones', () => {
    expect(parseObjectIds(['nope', id(0), '', "' or 1=1", id(1)])).toEqual([id(0), id(1)])
  })

  it('drops duplicates, keeping the first', () => {
    expect(parseObjectIds([id(0), id(1), id(0)])).toEqual([id(0), id(1)])
  })

  it('keeps at most the cap', () => {
    expect(MAX_BOARD_OBJECTS).toBe(10)
    expect(parseObjectIds(IDS)).toEqual(IDS.slice(0, 10))
  })

  it('counts the cap after dropping invalid values and duplicates', () => {
    expect(parseObjectIds(['bad', id(0), id(0), ...IDS.slice(1, 11)])).toEqual(IDS.slice(0, 10))
  })
})
