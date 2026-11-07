import type { PostgrestError } from '@supabase/supabase-js'

/** One page of a server-side list: the rows of the page and the exact total of the filtered set. */
export interface PageResult<Row> {
  rows: Row[]
  total: number
}

/** Sort of a list: an id from the entity's allowlist and a direction. */
export interface ListSort<Id extends string = string> {
  id: Id
  desc: boolean
}

/** A page window; `pageIndex` is 0-based. */
export interface PageWindow {
  pageIndex: number
  pageSize: number
}

export const MAX_PAGE_SIZE = 100
export const MAX_SEARCH_LENGTH = 100

/** The one definition of a search string: trimmed and capped. Used for the URL value, key and query. */
export function normalizeSearch(value: string): string {
  return value.trim().slice(0, MAX_SEARCH_LENGTH)
}

/**
 * «Contains» pattern for `ilike` that treats the text literally: `\ % _` are escaped at the LIKE
 * level. A literal `*` cannot be expressed in PostgREST (it is always a wildcard), so it becomes `_`.
 * For a plain `.ilike(column, pattern)`; inside `or(…)` pass it through `quoteFilterValue`.
 */
export function ilikeContains(text: string): string {
  const escaped = text.replace(/[\\%_*]/g, (char) => (char === '*' ? '_' : `\\${char}`))
  return `*${escaped}*`
}

/**
 * Quotes a value inside `or(…)`: PostgREST consumes one backslash level there, so `\` is doubled and
 * `"` is escaped. `, ( ) :` stay literal inside the quotes.
 */
export function quoteFilterValue(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/** The requested window starts after the last row (`PGRST103`). */
export function isRangeNotSatisfiable(error: { code?: string }): boolean {
  return error.code === 'PGRST103'
}

/** Inclusive row range for `.range()`. Fails fast on values the UI never produces. */
export function pageRange({ pageIndex, pageSize }: PageWindow): [from: number, to: number] {
  if (!Number.isInteger(pageIndex) || pageIndex < 0) throw new RangeError('pageIndex must be >= 0')
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new RangeError(`pageSize must be 1..${String(MAX_PAGE_SIZE)}`)
  }
  const from = pageIndex * pageSize
  return [from, from + pageSize - 1]
}

interface CountResponse {
  count: number | null
  error: PostgrestError | null
}

interface RowsResponse<Row> extends CountResponse {
  data: Row[] | null
}

/**
 * Reads a page. A page beyond the last one fails with `PGRST103`; then the total is read by `readTotal`
 * (the same filters, a head request WITHOUT a range) and the page is empty, so the UI can move to
 * the last page.
 */
export async function readPage<Row>(
  readRows: () => PromiseLike<RowsResponse<Row>>,
  readTotal: () => PromiseLike<CountResponse>,
): Promise<PageResult<Row>> {
  const page = await readRows()
  if (page.error === null) return { rows: page.data ?? [], total: page.count ?? 0 }
  if (!isRangeNotSatisfiable(page.error)) throw page.error
  const head = await readTotal()
  if (head.error !== null) throw head.error
  return { rows: [], total: head.count ?? 0 }
}
