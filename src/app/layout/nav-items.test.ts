import { describe, expect, it } from 'vitest'

import { NAV_ITEMS } from './nav-items'

describe('NAV_ITEMS', () => {
  it('shows the board to both roles', () => {
    const board = NAV_ITEMS.find((item) => item.to === '/board')
    expect(board?.labelKey).toBe('nav.board')
    expect(board?.listKey).toBe('board')
    expect([...(board?.roles ?? [])].sort()).toEqual(['executor', 'manager'])
  })

  it('keeps «Мои задачи» for executors only', () => {
    expect(NAV_ITEMS.find((item) => item.to === '/my-tasks')?.roles).toEqual(['executor'])
  })
})
