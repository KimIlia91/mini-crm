/**
 * Classes for an inline text link (table cell, definition list). The block-level box keeps the
 * target at least 24px high; long names wrap instead of widening the page.
 */
export const textLinkClass =
  'inline-flex min-h-6 max-w-full items-center rounded-sm font-medium underline-offset-4 [overflow-wrap:anywhere] hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none'
