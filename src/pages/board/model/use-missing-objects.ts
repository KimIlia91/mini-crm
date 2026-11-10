import { useQueries } from '@tanstack/react-query'

import { objectQueries } from '@/entities/object'

/** Which of the filtered object ids no longer exist or are not visible to the viewer. */
export function useMissingObjects(objectIds: readonly string[]) {
  const details = useQueries({ queries: objectIds.map((id) => objectQueries.detail(id)) })
  const missing = objectIds.filter((_, index) => {
    const detail = details[index]
    return detail?.isSuccess === true && detail.data === null
  })
  return {
    missing,
    missingKey: missing.join(','),
    allMissing: objectIds.length > 0 && missing.length === objectIds.length,
  }
}
