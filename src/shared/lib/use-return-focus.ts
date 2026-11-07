import { useCallback, useRef } from 'react'

/**
 * Gives focus back to the control that opened a controlled dialog (one without a `Trigger`, e.g.
 * opened from a row menu): call `remember(element)` when opening and pass `onCloseAutoFocus` to the
 * dialog. Both callbacks are stable.
 */
export function useReturnFocus() {
  const target = useRef<HTMLElement | null>(null)
  const remember = useCallback((element: HTMLElement | null) => {
    target.current = element
  }, [])
  const onCloseAutoFocus = useCallback((event: Event) => {
    if (target.current?.isConnected) {
      event.preventDefault()
      target.current.focus()
    }
  }, [])
  return { remember, onCloseAutoFocus }
}
