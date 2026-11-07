/** Only same-origin absolute paths are accepted as a post-login target (no open redirect). */
export function getRedirectTarget(state: unknown): string {
  if (typeof state === 'object' && state !== null && 'from' in state) {
    const from = state.from
    if (
      typeof from === 'string' &&
      from.startsWith('/') &&
      !from.startsWith('//') &&
      !from.startsWith('/\\')
    ) {
      return from
    }
  }
  return '/'
}
