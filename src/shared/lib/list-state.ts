const PREFIX = 'mini-crm:list:'
const OPENED_PREFIX = `${PREFIX}opened:`
/** Only these query parameters are ever stored; everything else in a URL is dropped. */
const ALLOWED_PARAMS = ['q', 'status', 'sort', 'page', 'size'] as const
const MAX_VALUE_LENGTH = 200
const MAX_KEY_LENGTH = 100

function storage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    // Blocked storage (privacy mode, sandboxed frame): lists simply start from the defaults.
    return null
  }
}

/** Keeps only the known list parameters with sane lengths; anything else is not stored or restored. */
export function sanitizeListSearch(search: string): string {
  const source = new URLSearchParams(search)
  const clean = new URLSearchParams()
  for (const name of ALLOWED_PARAMS) {
    const value = source.get(name)
    if (value !== null && value !== '' && value.length <= MAX_VALUE_LENGTH) clean.set(name, value)
  }
  return clean.toString()
}

function validKey(listKey: string): boolean {
  return listKey !== '' && listKey.length <= MAX_KEY_LENGTH
}

/** `path` with the remembered search of the list appended: links back to a list keep its state. */
export function listHref(path: string, listKey: string): string {
  const search = readListSearch(listKey)
  return search === '' ? path : `${path}?${search}`
}

/** Remembers the filter / sort / page of a list for this tab (an empty search forgets it). */
export function rememberListSearch(listKey: string, search: string): void {
  if (!validKey(listKey)) return
  const clean = sanitizeListSearch(search)
  try {
    if (clean === '') storage()?.removeItem(PREFIX + listKey)
    else storage()?.setItem(PREFIX + listKey, clean)
  } catch {
    // Quota or blocked storage: not remembering is harmless.
  }
}

/** The remembered search of a list, validated again on the way out (storage is untrusted input). */
export function readListSearch(listKey: string): string {
  if (!validKey(listKey)) return ''
  try {
    return sanitizeListSearch(storage()?.getItem(PREFIX + listKey) ?? '')
  } catch {
    return ''
  }
}

/** The row a user opened from a list, so that returning can scroll to it and focus its link. */
export function rememberOpenedRow(listKey: string, rowId: string): void {
  if (!validKey(listKey) || rowId.length > MAX_VALUE_LENGTH) return
  try {
    storage()?.setItem(OPENED_PREFIX + listKey, rowId)
  } catch {
    // See above.
  }
}

/** The opened row, left in place (the caller forgets it once the focus is restored). */
export function peekOpenedRow(listKey: string): string | null {
  if (!validKey(listKey)) return null
  try {
    const id = storage()?.getItem(OPENED_PREFIX + listKey) ?? null
    return id !== null && id.length <= MAX_VALUE_LENGTH ? id : null
  } catch {
    return null
  }
}

export function forgetOpenedRow(listKey: string): void {
  if (!validKey(listKey)) return
  try {
    storage()?.removeItem(OPENED_PREFIX + listKey)
  } catch {
    // See above.
  }
}

/** Reads and forgets the opened row: the focus is restored once. */
export function takeOpenedRow(listKey: string): string | null {
  const id = peekOpenedRow(listKey)
  forgetOpenedRow(listKey)
  return id
}

/** Forgets every remembered list state: called on sign-out and when the user changes. */
export function clearListStates(): void {
  try {
    const store = storage()
    if (!store) return
    const keys: string[] = []
    for (let index = 0; index < store.length; index++) {
      const key = store.key(index)
      if (key?.startsWith(PREFIX)) keys.push(key)
    }
    for (const key of keys) store.removeItem(key)
  } catch {
    // Nothing to clear when storage is not available.
  }
}
