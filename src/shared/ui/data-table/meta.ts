/*
 * Adapted from shadcn-admin (https://github.com/satnaing/shadcn-admin),
 * Copyright (c) 2024 Sat Naing, MIT License. See THIRD_PARTY_NOTICES.md.
 */

/** Optional `columnDef.meta` read by the data-table primitives. */
export interface DataTableColumnMeta {
  /** Classes for both the header and body cells (e.g. a `min-w` that makes the wrapper scroll instead of squeezing the text). */
  className?: string
  /** Human-readable column name for the "Columns" menu (falls back to the column id). */
  label?: string
}
