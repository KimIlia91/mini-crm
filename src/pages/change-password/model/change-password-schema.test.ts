import { describe, expect, it } from 'vitest'

import { changePasswordErrorKey, changePasswordSchema } from './change-password-schema'

function messages(newPassword: string, confirmPassword: string): string[] {
  const result = changePasswordSchema.safeParse({ newPassword, confirmPassword })
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

describe('changePasswordSchema', () => {
  it('accepts a strong matching password (8 chars is the boundary)', () => {
    expect(messages('Abcdef1x', 'Abcdef1x')).toEqual([])
  })

  it('rejects short passwords', () => {
    expect(messages('Abcde1x', 'Abcde1x')).toContain('validation.minLength')
  })

  it.each([
    ['ABCDEFG1', 'validation.lowercase'],
    ['abcdefg1', 'validation.uppercase'],
    ['Abcdefgh', 'validation.digit'],
  ])('rejects %s', (password, message) => {
    expect(messages(password, password)).toContain(message)
  })

  it('rejects mismatching repeat', () => {
    expect(messages('Abcdef1x', 'Abcdef1y')).toContain('validation.mismatch')
  })
})

describe('changePasswordErrorKey', () => {
  it('maps server error codes to translation keys', () => {
    expect(changePasswordErrorKey('same_password')).toBe('errors.samePassword')
    expect(changePasswordErrorKey('weak_password')).toBe('errors.weakPassword')
    expect(changePasswordErrorKey(undefined)).toBe('errors.generic')
    expect(changePasswordErrorKey('anything_else')).toBe('errors.generic')
  })
})
