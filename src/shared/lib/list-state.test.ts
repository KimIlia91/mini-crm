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
