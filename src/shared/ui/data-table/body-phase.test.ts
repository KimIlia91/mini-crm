import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useBodyPhase, type BodyPhase } from './body-phase'

function setup(initial: BodyPhase) {
  return renderHook(({ phase }) => useBodyPhase(phase), { initialProps: { phase: initial } })
}

describe('useBodyPhase', () => {
  it('shows the initial phase at full opacity', () => {
    const { result } = setup('data')
    expect(result.current).toMatchObject({ shown: 'data', opacity: 1 })
  })

  it('leaves hold for data without a fade-out: the data is shown at once', () => {
    const { result, rerender } = setup('hold')
    expect(result.current).toMatchObject({ shown: 'hold', opacity: 0 })
    rerender({ phase: 'data' })
    expect(result.current).toMatchObject({ shown: 'data', opacity: 1 })
  })

  it('fades data out first, swaps to the skeleton after the fade, then fades in', () => {
    const { result, rerender } = setup('data')
    rerender({ phase: 'skeleton' })
    expect(result.current).toMatchObject({ shown: 'data', opacity: 0 })
    act(() => {
      result.current.onFadeEnd()
    })
    expect(result.current).toMatchObject({ shown: 'skeleton', opacity: 1 })
    rerender({ phase: 'data' })
    expect(result.current).toMatchObject({ shown: 'skeleton', opacity: 0 })
    act(() => {
      result.current.onFadeEnd()
    })
    expect(result.current).toMatchObject({ shown: 'data', opacity: 1 })
  })

  it('returning to the shown phase before the fade ends cancels the swap', () => {
    const { result, rerender } = setup('data')
    rerender({ phase: 'skeleton' })
    rerender({ phase: 'data' })
    expect(result.current).toMatchObject({ shown: 'data', opacity: 1 })
    act(() => {
      result.current.onFadeEnd()
    })
    expect(result.current).toMatchObject({ shown: 'data', opacity: 1 })
  })
})
