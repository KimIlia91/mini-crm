import { describe, expect, it } from 'vitest'

import { getRedirectTarget } from './redirect-target'

describe('getRedirectTarget', () => {
  it.each(['/objects', '/tasks/1?x=y', '/'])('honours the internal path %s', (from) => {
    expect(getRedirectTarget({ from })).toBe(from)
  })

  it.each([
    '//evil.com',
    'https://evil.com',
    '/\\evil.com',
    'evil.com',
    '',
    42,
    null,
    undefined,
    { path: '/x' },
  ])('falls back to / for %j', (from) => {
    expect(getRedirectTarget({ from })).toBe('/')
  })

  it.each([null, undefined, 'x', 5, {}])('falls back to / for state %j', (state) => {
    expect(getRedirectTarget(state)).toBe('/')
  })
})
