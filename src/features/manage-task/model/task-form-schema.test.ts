import { describe, expect, it } from 'vitest'

import { taskFormSchema } from './task-form-schema'

const ASSIGNEE = '3b241101-e2bb-4255-8caf-4136c566a962'
const valid = { title: 'Проверить', description: '', assigneeId: ASSIGNEE }

function messages(input: unknown) {
  const result = taskFormSchema.safeParse(input)
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

describe('taskFormSchema', () => {
  it('accepts a valid task and trims the title', () => {
    const result = taskFormSchema.parse({ ...valid, title: '  Проверить  ' })
    expect(result.title).toBe('Проверить')
  })

  it('rejects an empty or whitespace-only title', () => {
    expect(messages({ ...valid, title: '' })).toContain('validation.titleRequired')
    expect(messages({ ...valid, title: '   ' })).toContain('validation.titleRequired')
  })

  it('accepts a title of exactly 200 characters and rejects 201', () => {
    expect(messages({ ...valid, title: 'a'.repeat(200) })).toEqual([])
    expect(messages({ ...valid, title: 'a'.repeat(201) })).toContain('validation.titleTooLong')
  })

  it('counts the title length after trimming', () => {
    expect(messages({ ...valid, title: ` ${'a'.repeat(200)} ` })).toEqual([])
  })

  it('accepts a description of exactly 5000 characters and rejects 5001', () => {
    expect(messages({ ...valid, description: 'a'.repeat(5000) })).toEqual([])
    expect(messages({ ...valid, description: 'a'.repeat(5001) })).toContain(
      'validation.descriptionTooLong',
    )
  })

  it('requires an assignee that is a uuid', () => {
    expect(messages({ ...valid, assigneeId: '' })).toContain('validation.assigneeRequired')
    expect(messages({ ...valid, assigneeId: 'not-a-uuid' })).toContain(
      'validation.assigneeRequired',
    )
  })
})
