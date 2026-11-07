/**
 * Narrows a message string (e.g. a Zod message that arrives in a form error as `string`) back to
 * one of the known translation keys, so `t(key)` stays type-checked without casts.
 */
export function pickKey<K extends string>(
  keys: readonly K[],
  message: string | undefined,
): K | undefined {
  return keys.find((key) => key === message)
}
