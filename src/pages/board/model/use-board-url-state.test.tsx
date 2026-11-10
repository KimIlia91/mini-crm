import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation, useNavigationType } from 'react-router'
import { describe, expect, it } from 'vitest'

import { listHref } from '@/shared/lib'

import { BOARD_LIST_KEY, useBoardUrlState } from './use-board-url-state'

const A = '0f0e0d0c-1111-4222-8333-444455556666'
const B = '1f0e0d0c-1111-4222-8333-444455556666'
const C = '2f0e0d0c-1111-4222-8333-444455556666'

function setup(entry: string, role: 'manager' | 'executor' = 'manager') {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
  )
  return renderHook(
    () => ({
      state: useBoardUrlState(role),
      location: useLocation(),
      navigationType: useNavigationType(),
    }),
    { wrapper },
  )
}

const search = (result: ReturnType<typeof setup>['result']) =>
  new URLSearchParams(result.current.location.search)

describe('useBoardUrlState', () => {
  it('reads several object ids in URL order', () => {
    const { result } = setup(`/board?object=${B}&object=${A}`)
    expect(result.current.state.objectIds).toEqual([B, A])
  })

  it('has no filter without object params', () => {
    const { result } = setup('/board')
    expect(result.current.state.objectIds).toEqual([])
  })

  it('removes invalid and duplicate ids from the URL by replacing the entry', () => {
    const { result } = setup(`/board?object=bad&object=${A}&object=${A}&column=rework`)
    expect(result.current.state.objectIds).toEqual([A])
    expect(search(result).getAll('object')).toEqual([A])
    expect(search(result).get('column')).toBe('rework')
    expect(result.current.navigationType).toBe('REPLACE')
  })

  it('caps the filter at ten objects', () => {
    const many = Array.from({ length: 12 }, () => crypto.randomUUID())
    const { result } = setup(`/board?${many.map((id) => `object=${id}`).join('&')}`)
    expect(result.current.state.objectIds).toEqual(many.slice(0, 10))
    expect(search(result).getAll('object')).toEqual(many.slice(0, 10))
  })

  it('picks the column by role when the URL has none or a bad one', () => {
    expect(setup('/board', 'executor').result.current.state.column).toBe('in_progress')
    expect(setup('/board?column=zzz').result.current.state.column).toBe('in_review')
    expect(setup('/board?column=accepted').result.current.state.column).toBe('accepted')
  })

  it('setObjectIds writes repeated params, keeps the column and pushes a history entry', () => {
    const { result } = setup('/board?column=rework')
    act(() => {
      result.current.state.setObjectIds([A, B])
    })
    expect(search(result).getAll('object')).toEqual([A, B])
    expect(search(result).get('column')).toBe('rework')
    expect(result.current.navigationType).toBe('PUSH')
    expect(result.current.state.objectIds).toEqual([A, B])
  })

  it('setObjectIds with an empty list clears the filter', () => {
    const { result } = setup(`/board?object=${A}`)
    act(() => {
      result.current.state.setObjectIds([])
    })
    expect(search(result).has('object')).toBe(false)
    expect(result.current.state.objectIds).toEqual([])
  })

  it('setColumn replaces the entry and keeps the objects', () => {
    const { result } = setup(`/board?object=${A}&object=${B}`)
    act(() => {
      result.current.state.setColumn('accepted')
    })
    expect(search(result).get('column')).toBe('accepted')
    expect(search(result).getAll('object')).toEqual([A, B])
    expect(result.current.navigationType).toBe('REPLACE')
  })

  it('dropObjectIds removes only the dropped ids by replacing the entry', () => {
    const { result } = setup(`/board?object=${A}&object=${B}&object=${C}`)
    act(() => {
      result.current.state.dropObjectIds([B])
    })
    expect(search(result).getAll('object')).toEqual([A, C])
    expect(result.current.navigationType).toBe('REPLACE')
  })

  it('remembers the board search for the way back', () => {
    setup(`/board?object=${A}&object=${B}&column=rework`)
    const remembered = new URLSearchParams(listHref('/board', BOARD_LIST_KEY).split('?')[1] ?? '')
    expect(remembered.getAll('object')).toEqual([A, B])
    expect(remembered.get('column')).toBe('rework')
  })
})
