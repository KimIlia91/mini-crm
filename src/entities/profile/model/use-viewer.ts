import { useQuery } from '@tanstack/react-query'

import { useSession } from '@/shared/auth'

import { profileQueries } from '../api/profile'
import type { Viewer } from './viewer'

export type ViewerState =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'missing' }
  | { status: 'ready'; viewer: Viewer }

/** Profile of the signed-in user, for guards that must handle every state. */
export function useViewerState(): ViewerState {
  const { userId } = useSession()
  const query = useQuery({ ...profileQueries.byId(userId ?? ''), enabled: userId !== null })

  if (query.isError && query.data === undefined) {
    return {
      status: 'error',
      retry: () => {
        void query.refetch()
      },
    }
  }
  if (query.isPending) return { status: 'loading' }
  if (query.data === null) return { status: 'missing' }
  return { status: 'ready', viewer: query.data }
}

/** For components rendered under RequireAuth, where the profile is guaranteed to be loaded. */
export function useViewer(): Viewer {
  const state = useViewerState()
  if (state.status !== 'ready') {
    throw new Error('useViewer must be used under RequireAuth (profile is not loaded)')
  }
  return state.viewer
}
