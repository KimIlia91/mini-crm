import { Navigate } from 'react-router'

import { useViewer } from '@/entities/profile'

export function HomeRedirect() {
  const viewer = useViewer()
  return <Navigate to={viewer.role === 'executor' ? '/my-tasks' : '/objects'} replace />
}
