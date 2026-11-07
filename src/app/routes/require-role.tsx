import { Navigate, Outlet } from 'react-router'

import { useViewer, type AppRole } from '@/entities/profile'

/** Must be rendered under RequireAuth. UX only; RLS enforces access. */
export function RequireRole({ role }: { role: AppRole }) {
  const viewer = useViewer()
  return viewer.role === role ? <Outlet /> : <Navigate to="/" replace />
}
