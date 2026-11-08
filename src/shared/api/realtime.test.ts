import { describe, expect, it } from 'vitest'

import { parseHint } from './realtime'

const ID = '4b0c7d0e-29f1-4f6a-9d3e-6a1d5c7e8f90'
const OTHER = '0d5e6c52-3d52-4a8e-8f6b-1d2b9e7f4a11'

describe('parseHint', () => {
  it('parses a task hint', () => {
    expect(parseHint('task', { id: ID, object_id: OTHER })).toEqual({
      kind: 'task',
      id: ID,
      objectId: OTHER,
    })
  })

  it('parses an object hint', () => {
    expect(parseHint('object', { id: ID })).toEqual({ kind: 'object', id: ID })
  })

  it('parses a notification hint and strips the extra id added by realtime.send', () => {
    const hint = parseHint('notification', { op: 'created', ids: [ID, OTHER], id: OTHER })
    expect(hint).toEqual({ kind: 'notification', op: 'created', ids: [ID, OTHER] })
  })

  it('parses a manager-wide notification hint that carries no ids', () => {
    expect(parseHint('notification', { op: 'created' })).toEqual({
      kind: 'notification',
      op: 'created',
    })
  })

  it('rejects malformed payloads', () => {
    expect(parseHint('task', { id: ID })).toBeUndefined()
    expect(parseHint('task', { id: 'x', object_id: OTHER })).toBeUndefined()
    expect(parseHint('notification', { op: 'deleted', ids: [ID] })).toBeUndefined()
    expect(parseHint('notification', { op: 'updated', ids: ['nope'] })).toBeUndefined()
    expect(parseHint('object', null)).toBeUndefined()
    expect(parseHint('object', 'text')).toBeUndefined()
  })

  it('ignores unknown events', () => {
    expect(parseHint('other', { id: ID })).toBeUndefined()
  })
})
