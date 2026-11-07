import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useLocation } from 'react-router'

import { useViewerState } from '@/entities/profile'
import { useSession } from '@/shared/auth'

import { FullPageMessage } from './full-page-message'
import { NoAccess } from './no-access'

export const CHANGE_PASSWORD_PATH = '/change-password'

/**
 * Gate for everything behind login: session -> profile -> forced password change.
 * UX only; the database enforces the same rules.
 */
export function RequireAuth() {
  const { t } = useTranslation('common')
  const session = useSession()
  const viewerState = useViewerState()
  const location = useLocation()

  if (session.status === 'loading') return <FullPageMessage>{t('loading')}</FullPageMessage>
  if (session.status === 'signed-out') {
    const from = `${location.pathname}${location.search}`
    return <Navigate to="/login" replace state={{ from }} />
  }

  switch (viewerState.status) {
    case 'loading':
      return <FullPageMessage>{t('loading')}</FullPageMessage>
    case 'error':
      return <NoAccess failed onRetry={viewerState.retry} />
    case 'missing':
      return <NoAccess />
    case 'ready': {
      const onChangePassword = location.pathname === CHANGE_PASSWORD_PATH
      if (viewerState.viewer.mustChangePassword && !onChangePassword) {
        return <Navigate to={CHANGE_PASSWORD_PATH} replace />
      }
      if (!viewerState.viewer.mustChangePassword && onChangePassword) {
        return <Navigate to="/" replace />
      }
      return <Outlet />
    }
  }
}
