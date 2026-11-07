import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LOADER_DELAY_MS, useDelayedFlag } from './use-delayed-flag'

describe('useDelayedFlag', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays false until the delay has passed, then turns true', () => {
    const { result } = renderHook(() => useDelayedFlag(true))
    expect(result.current).toBe(false)
    act(() => {
      vi.advanceTimersByTime(LOADER_DELAY_MS - 1)
    })
    expect(result.current).toBe(false)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe(true)
  })

  it('never turns true when the activity ends before the delay', () => {
    const { result, rerender } = renderHook(({ active }) => useDelayedFlag(active), {
      initialProps: { active: true },
    })
    act(() => {
      vi.advanceTimersByTime(LOADER_DELAY_MS - 50)
    })
    rerender({ active: false })
    act(() => {
      vi.advanceTimersByTime(LOADER_DELAY_MS * 2)
    })
    expect(result.current).toBe(false)
  })

  it('turns false at once when the activity ends after the delay, and restarts the delay', () => {
    const { result, rerender } = renderHook(({ active }) => useDelayedFlag(active), {
      initialProps: { active: true },
    })
    act(() => {
      vi.advanceTimersByTime(LOADER_DELAY_MS)
    })
    expect(result.current).toBe(true)
    rerender({ active: false })
    expect(result.current).toBe(false)
    rerender({ active: true })
    expect(result.current).toBe(false)
    act(() => {
      vi.advanceTimersByTime(LOADER_DELAY_MS)
    })
    expect(result.current).toBe(true)
  })

  it('honours a custom delay', () => {
    const { result } = renderHook(() => useDelayedFlag(true, 50))
    act(() => {
      vi.advanceTimersByTime(50)
    })
    expect(result.current).toBe(true)
  })
})
