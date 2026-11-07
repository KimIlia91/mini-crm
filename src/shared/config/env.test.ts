import { describe, expect, it } from 'vitest'

import { parseClientEnv } from './env'

const valid = {
  VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc',
}

describe('parseClientEnv', () => {
  it('accepts a valid local configuration', () => {
    expect(parseClientEnv(valid)).toEqual(valid)
  })

  it('rejects a missing URL', () => {
    expect(() => parseClientEnv({ ...valid, VITE_SUPABASE_URL: undefined })).toThrow(
      /VITE_SUPABASE_URL/,
    )
  })

  it('rejects a malformed URL', () => {
    expect(() => parseClientEnv({ ...valid, VITE_SUPABASE_URL: 'not a url' })).toThrow()
  })

  it('rejects an empty key (boundary)', () => {
    expect(() => parseClientEnv({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: '' })).toThrow()
  })

  it('refuses a secret key in the browser bundle', () => {
    expect(() =>
      parseClientEnv({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_xyz' }),
    ).toThrow(/Secret keys/)
  })

  describe('legacy JWT keys', () => {
    // Fake, test-generated tokens: unsigned, never valid against any server.
    const b64url = (value: string) =>
      btoa(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
    const jwt = (payload: unknown) =>
      [
        b64url('{"alg":"HS256","typ":"JWT"}'),
        b64url(JSON.stringify(payload)),
        'fake-signature',
      ].join('.')
    const withKey = (key: string) => ({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: key })

    // The privileged role is deliberately not named (lint rule no-restricted-syntax):
    // its rejection follows from the allow-list - any non-anon role is refused.
    it.each(['authenticated', 'admin'])('rejects a JWT with a non-anon role (%s)', (role) => {
      expect(() => parseClientEnv(withKey(jwt({ role })))).toThrow(/publishable or anon/)
    })

    it('rejects a non-anon JWT whose payload needs base64url padding and url-safe chars', () => {
      const payload = { role: 'admin', note: '???>>>~~~' }
      expect(() => parseClientEnv(withKey(jwt(payload)))).toThrow(/publishable or anon/)
    })

    it('accepts a legacy anon JWT', () => {
      const key = jwt({ role: 'anon' })
      expect(parseClientEnv(withKey(key)).VITE_SUPABASE_PUBLISHABLE_KEY).toBe(key)
    })

    it('accepts a publishable key', () => {
      expect(parseClientEnv(withKey('sb_publishable_fake')).VITE_SUPABASE_PUBLISHABLE_KEY).toBe(
        'sb_publishable_fake',
      )
    })

    it('rejects a JWT-like key with an unparsable payload', () => {
      expect(() => parseClientEnv(withKey('aaa.!!!not-base64!!!.ccc'))).toThrow(
        /publishable or anon/,
      )
      expect(() => parseClientEnv(withKey(`a.${b64url('not json')}.c`))).toThrow(
        /publishable or anon/,
      )
    })

    it('accepts an anon JWT whose payload needs base64url padding and url-safe chars', () => {
      const key = jwt({ role: 'anon', note: '???>>>~~~' })
      // The fixture really exercises the url-safe alphabet and the missing padding.
      expect(key.split('.')[1]).toMatch(/[-_]/)
      expect((key.split('.')[1] ?? '').length % 4).not.toBe(0)
      expect(parseClientEnv(withKey(key)).VITE_SUPABASE_PUBLISHABLE_KEY).toBe(key)
    })

    it('rejects a JWT without a role or with a non-string role', () => {
      expect(() => parseClientEnv(withKey(jwt({ sub: 'x' })))).toThrow(/publishable or anon/)
      expect(() => parseClientEnv(withKey(jwt({ role: 1 })))).toThrow(/publishable or anon/)
    })

    it('rejects an arbitrary non-key string', () => {
      expect(() => parseClientEnv(withKey('hello'))).toThrow(/publishable or anon/)
    })
  })
})
