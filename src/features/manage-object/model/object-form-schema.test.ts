import { describe, expect, it } from 'vitest'

import { objectErrorKey, ObjectNotAvailableError } from './object-error'
import { objectFormSchema } from './object-form-schema'

describe('objectFormSchema', () => {
  it('trims values', () => {
    const result = objectFormSchema.parse({ name: '  Склад ', address: ' ул. Ленина, 1 ' })
    expect(result).toEqual({ name: 'Склад', address: 'ул. Ленина, 1' })
  })

  it.each([
    ['empty name', { name: '', address: 'a' }],
    ['whitespace name', { name: '   ', address: 'a' }],
    ['empty address', { name: 'n', address: '' }],
    ['whitespace address', { name: 'n', address: '  ' }],
    ['name 201', { name: 'a'.repeat(201), address: 'a' }],
    ['address 501', { name: 'n', address: 'a'.repeat(501) }],
  ])('rejects %s', (_label, input) => {
    expect(objectFormSchema.safeParse(input).success).toBe(false)
  })

  it('accepts boundary lengths', () => {
    expect(objectFormSchema.safeParse({ name: 'a', address: 'b' }).success).toBe(true)
    expect(
      objectFormSchema.safeParse({ name: 'a'.repeat(200), address: 'b'.repeat(500) }).success,
    ).toBe(true)
  })

  it('measures length after trimming', () => {
    const padded = ` ${'a'.repeat(200)} `
    expect(objectFormSchema.safeParse({ name: padded, address: 'b' }).success).toBe(true)
  })
})

describe('objectErrorKey', () => {
  it.each([
    ['P0001', 'object_has_tasks', 'errors.hasTasks'],
    ['P0001', 'object_not_found', 'errors.notAvailable'],
    ['23514', 'x', 'errors.invalidFields'],
    ['42501', 'x', 'errors.forbidden'],
  ])('maps %s %s', (code, message, key) => {
    expect(objectErrorKey({ code, message })).toBe(key)
  })

  it('maps zero affected rows', () => {
    expect(objectErrorKey(new ObjectNotAvailableError())).toBe('errors.notAvailable')
  })

  it.each([[{ code: '99999' }], [new Error('boom')], [null], ['str']])(
    'falls back to a generic message',
    (error) => {
      expect(objectErrorKey(error)).toBe('errors.generic')
    },
  )
})
