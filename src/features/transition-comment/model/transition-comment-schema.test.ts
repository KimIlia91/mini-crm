import { describe, expect, it } from 'vitest'

import { COMMENT_FORM_ERRORS, commentSchema } from './transition-comment-schema'

function messages(comment: string): string[] {
  const result = commentSchema.safeParse({ comment })
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

describe('commentSchema', () => {
  it.each(['', ' ', '   ', '\t', '\n', ' \t\n '])('rejects %j as required', (value) => {
    expect(messages(value)).toEqual([COMMENT_FORM_ERRORS.required])
  })

  it('accepts one character and exactly 1000 characters', () => {
    expect(messages('a')).toEqual([])
    expect(messages('a'.repeat(1000))).toEqual([])
  })

  it('rejects 1001 characters', () => {
    expect(messages('a'.repeat(1001))).toEqual([COMMENT_FORM_ERRORS.tooLong])
  })

  it('trims before measuring: 1000 characters padded with spaces is valid', () => {
    expect(messages(` ${'a'.repeat(1000)} `)).toEqual([])
  })

  it('returns the trimmed value', () => {
    expect(commentSchema.parse({ comment: '  Нет фото \n' })).toEqual({ comment: 'Нет фото' })
  })
})
