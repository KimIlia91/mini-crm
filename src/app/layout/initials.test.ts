import { describe, expect, it } from 'vitest'

import { getInitials } from './initials'

describe('getInitials', () => {
  it.each([
    ['Иван Петров', 'ИП'],
    ['  иван   петров  сидоров ', 'ИП'],
    ['Мадонна', 'М'],
    ['', ''],
    ['   ', ''],
    ['😀smile Ann', '😀A'],
  ])('%j -> %j', (name, initials) => {
    expect(getInitials(name)).toBe(initials)
  })
})
