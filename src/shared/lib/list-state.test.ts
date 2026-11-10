import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearListStates,
  readListSearch,
  rememberListSearch,
  rememberOpenedRow,
  sanitizeListSearch,
  takeOpenedRow,
} from './list-state'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.sessionStorage.clear()
})

describe('list state', () => {
  it('remembers and restores a list search per list key', () => {
    rememberListSearch('objects', 'page=20&size=50&q=склад')
    rememberListSearch('my-tasks', 'status=new')
    expect(new URLSearchParams(readListSearch('objects')).get('page')).toBe('20')
    expect(new URLSearchParams(readListSearch('objects')).get('q')).toBe('склад')
    expect(readListSearch('my-tasks')).toBe('status=new')
    expect(readListSearch('object:other')).toBe('')
  })

  it('stores only the known list parameters', () => {
    rememberListSearch('objects', 'page=2&token=secret&redirect=//evil.com')
    expect(readListSearch('objects')).toBe('page=2')
    expect(sanitizeListSearch('q=a&unknown=1&sort=-name')).toBe('q=a&sort=-name')
  })

  it('drops oversized values and ignores an invalid key', () => {
    rememberListSearch('objects', `q=${'a'.repeat(201)}`)
    expect(readListSearch('objects')).toBe('')
    rememberListSearch('', 'page=2')
    expect(readListSearch('')).toBe('')
  })

  it('validates again on read: a tampered value is cleaned', () => {
    window.sessionStorage.setItem('mini-crm:list:objects', 'page=3&evil=1')
    expect(readListSearch('objects')).toBe('page=3')
  })

  it('an empty search forgets the list', () => {
    rememberListSearch('objects', 'page=2')
    rememberListSearch('objects', '')
    expect(readListSearch('objects')).toBe('')
  })

  it('remembers the opened row once', () => {
    rememberOpenedRow('objects', 'row-1')
    expect(takeOpenedRow('objects')).toBe('row-1')
    expect(takeOpenedRow('objects')).toBeNull()
  })

  it('clearListStates removes every list state and the opened rows, nothing else', () => {
    rememberListSearch('objects', 'page=2')
    rememberOpenedRow('objects', 'row-1')
    window.sessionStorage.setItem('unrelated', 'keep')
    clearListStates()
    expect(readListSearch('objects')).toBe('')
    expect(takeOpenedRow('objects')).toBeNull()
    expect(window.sessionStorage.getItem('unrelated')).toBe('keep')
  })

  it('works without storage: nothing throws, nothing is restored', () => {
    const blocked = () => {
      throw new Error('blocked')
    }
    vi.stubGlobal('sessionStorage', {
      getItem: blocked,
      setItem: blocked,
      removeItem: blocked,
      key: blocked,
      length: 1,
    })
    expect(() => {
      rememberListSearch('objects', 'page=2')
      rememberOpenedRow('objects', 'row-1')
      clearListStates()
    }).not.toThrow()
    expect(readListSearch('objects')).toBe('')
    expect(takeOpenedRow('objects')).toBeNull()
  })
})

describe('repeated object parameter', () => {
  const ids = Array.from(
    { length: 12 },
    (_, i) => `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`,
  )

  it('keeps several object values in order', () => {
    expect(sanitizeListSearch(`object=${ids[1]}&object=${ids[0]}`)).toBe(
      `object=${ids[1]}&object=${ids[0]}`,
    )
  })

  it('keeps at most ten object values', () => {
    const clean = new URLSearchParams(sanitizeListSearch(ids.map((id) => `object=${id}`).join('&')))
    expect(clean.getAll('object')).toEqual(ids.slice(0, 10))
  })

  it('drops empty and oversized object values individually', () => {
    const clean = new URLSearchParams(
      sanitizeListSearch(`object=&object=${ids[0]}&object=${'a'.repeat(201)}`),
    )
    expect(clean.getAll('object')).toEqual([ids[0]])
  })

  it('still keeps a single value for the other parameters', () => {
    expect(sanitizeListSearch('q=a&q=b&column=new&column=rework')).toBe('q=a&column=new')
  })

  it('round-trips several objects through storage', () => {
    rememberListSearch('board', `object=${ids[0]}&object=${ids[1]}`)
    expect(new URLSearchParams(readListSearch('board')).getAll('object')).toEqual([ids[0], ids[1]])
  })
})

describe('list state of the board', () => {
  const objectId = '0f0e0d0c-1111-4222-8333-444455556666'

  it('keeps the object and the column', () => {
    expect(sanitizeListSearch(`object=${objectId}&column=in_review`)).toBe(
      `object=${objectId}&column=in_review`,
    )
    rememberListSearch('board', `object=${objectId}&column=rework`)
    expect(new URLSearchParams(readListSearch('board')).get('object')).toBe(objectId)
    expect(new URLSearchParams(readListSearch('board')).get('column')).toBe('rework')
  })

  it('drops unknown parameters next to the board ones', () => {
    expect(
      sanitizeListSearch(`object=${objectId}&token=secret&column=new&redirect=//evil.com`),
    ).toBe(`object=${objectId}&column=new`)
  })

  it('cuts overlong object and column values', () => {
    expect(sanitizeListSearch(`object=${'a'.repeat(201)}&column=new`)).toBe('column=new')
    expect(sanitizeListSearch(`object=${objectId}&column=${'x'.repeat(201)}`)).toBe(
      `object=${objectId}`,
    )
  })

  it('keeps the board state apart from the other lists', () => {
    rememberListSearch('board', `object=${objectId}`)
    rememberListSearch('my-tasks', 'status=new')
    expect(readListSearch('my-tasks')).toBe('status=new')
    expect(readListSearch('board')).toBe(`object=${objectId}`)
  })
})
