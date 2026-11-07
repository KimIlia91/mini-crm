import { useEffect } from 'react'
import { useLocation } from 'react-router'

import { forgetOpenedRow, peekOpenedRow, rememberOpenedRow } from './list-state'

/** How long the row may take to appear (skeleton fade, page transition) before it is given up. */
const WAIT_MS = 3_000

/** Props for the link that opens a row: it marks itself and remembers the row for the way back. */
export function openedRowLink(listKey: string, rowId: string) {
  return {
    'data-row-link': rowId,
    onClick: () => {
      rememberOpenedRow(listKey, rowId)
    },
  }
}

function findRowLink(rowId: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-row-link]')).find(
    (element) => element.dataset.rowLink === rowId,
  )
}

/**
 * After coming back to a list, brings the row that was opened into view and focuses its link
 * (once). Data being ready does not mean the row is in the DOM yet (the table may still be fading
 * in from its skeleton), so the link is awaited for a short while. The remembered row is forgotten
 * when it is used or when it does not show up (it is not on this page).
 */
export function useRestoreOpenedRow(listKey: string, ready: boolean): void {
  const locationKey = useLocation().key
  useEffect(() => {
    if (!ready || locationKey === '') return
    const remembered = peekOpenedRow(listKey)
    if (remembered === null) return
    const rowId: string = remembered

    const observer = new MutationObserver(() => {
      tryFocus()
    })
    const timer = setTimeout(() => {
      stop()
      forgetOpenedRow(listKey)
    }, WAIT_MS)
    function stop() {
      observer.disconnect()
      clearTimeout(timer)
    }
    function tryFocus() {
      const link = findRowLink(rowId) 
      if (!link) return
      link.focus({ preventScroll: true })
      if (document.activeElement !== link) return
      stop()
      forgetOpenedRow(listKey)
      link.scrollIntoView({ block: 'nearest' })
    }

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['inert'],
    })
    tryFocus()
    return stop
  }, [listKey, ready, locationKey])
}
