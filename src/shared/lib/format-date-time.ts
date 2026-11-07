const formatter = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' })

/** ISO string or Date -> «06.11.2026, 14:05» in the user's time zone. */
export function formatDateTime(value: string | Date): string {
  return formatter.format(typeof value === 'string' ? new Date(value) : value)
}

const fullFormatter = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'medium' })

/** ISO string or Date -> «6 ноября 2026 г. в 14:05:09»; for `title` tooltips next to the short form. */
export function formatDateTimeFull(value: string | Date): string {
  return fullFormatter.format(typeof value === 'string' ? new Date(value) : value)
}
