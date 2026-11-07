import { beforeAll, describe, expect, it } from 'vitest'

import { createTestUser, type TestUser } from '../setup/supabase'

// Object CRUD and validation boundaries (own unique objects per test; no global counts).

let manager: TestUser

beforeAll(async () => {
  manager = await createTestUser('manager', 'obj-m')
})

const uniqueName = (suffix = '') => `obj-${crypto.randomUUID()}${suffix}`

describe('object name and address', () => {
  it('creates, edits and soft-deletes an object via RPC', async () => {
    const created = await manager.client
      .from('objects')
      .insert({ name: uniqueName(), address: 'Main st. 1' })
      .select('id, name')
      .single()
    expect(created.error).toBeNull()
    const id = created.data?.id ?? ''

    const renamed = await manager.client
      .from('objects')
      .update({ name: 'renamed' })
      .eq('id', id)
      .select('name')
      .single()
    expect(renamed.data?.name).toBe('renamed')

    const removed = await manager.client.rpc('delete_object', { p_object_id: id })
    expect(removed.error).toBeNull()
    const { data } = await manager.client.from('objects').select('id').eq('id', id)
    expect(data).toEqual([])

    const again = await manager.client.rpc('delete_object', { p_object_id: id })
    expect(again.error).toMatchObject({ code: 'P0001', message: 'object_not_found' })

    const edit = await manager.client
      .from('objects')
      .update({ name: 'after-delete' })
      .eq('id', id)
      .select('name')
      .single()
    expect(edit.error?.code).toBe('PGRST116')
  })

  it('delete_object of an unknown id is object_not_found', async () => {
    const { error } = await manager.client.rpc('delete_object', {
      p_object_id: crypto.randomUUID(),
    })
    expect(error).toMatchObject({ code: 'P0001', message: 'object_not_found' })
  })

  it('direct client DELETE is forbidden with 42501', async () => {
    const { data } = await manager.client
      .from('objects')
      .insert({ name: uniqueName(), address: 'a' })
      .select('id')
      .single()
    const id = data?.id ?? ''
    const { error } = await manager.client.from('objects').delete().eq('id', id)
    expect(error?.code).toBe('42501')
    const { data: still } = await manager.client.from('objects').select('id').eq('id', id)
    expect(still).toHaveLength(1)
  })

  it.each([
    ['empty', ''],
    ['spaces-only', '    '],
  ])('rejects %s name with 23514', async (_label, name) => {
    const { error } = await manager.client.from('objects').insert({ name, address: 'addr' })
    expect(error?.code).toBe('23514')
  })

  it('rejects a tab/newline-only name with 23514', async () => {
    const { error } = await manager.client.from('objects').insert({ name: '\t\n', address: 'addr' })
    expect(error?.code).toBe('23514')
  })

  it('name: 200 characters ok, 201 rejected', async () => {
    const ok = await manager.client.from('objects').insert({ name: 'n'.repeat(200), address: 'a' })
    expect(ok.error).toBeNull()
    const bad = await manager.client.from('objects').insert({ name: 'n'.repeat(201), address: 'a' })
    expect(bad.error?.code).toBe('23514')
  })

  it('rejects empty and whitespace address', async () => {
    for (const address of ['', '  ']) {
      const { error } = await manager.client.from('objects').insert({ name: uniqueName(), address })
      expect(error?.code).toBe('23514')
    }
  })

  it('rejects renaming an object to a whitespace name; the old name stays', async () => {
    const name = uniqueName()
    const { data } = await manager.client
      .from('objects')
      .insert({ name, address: 'a' })
      .select('id')
      .single()
    const id = data?.id ?? ''
    const { error } = await manager.client.from('objects').update({ name: '  ' }).eq('id', id)
    expect(error?.code).toBe('23514')
    const { data: row } = await manager.client.from('objects').select('name').eq('id', id).single()
    expect(row?.name).toBe(name)
  })
})
