import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

import './i18n'

// jsdom has no matchMedia; the sidebar's mobile detection and the theme provider read it.
if (typeof window.matchMedia !== 'function') {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
}

// Radix Select / menus rely on pointer-capture and scrollIntoView, which jsdom lacks.
Object.assign(Element.prototype, {
  hasPointerCapture: () => false,
  setPointerCapture: () => undefined,
  releasePointerCapture: () => undefined,
  scrollIntoView: () => undefined,
})

// jsdom's window.scrollTo only logs "Not implemented"; the layout resets scroll after page changes.
window.scrollTo = () => undefined

afterEach(() => {
  cleanup()
  // Remembered list searches must not leak from one test into the next.
  window.sessionStorage.clear()
})
