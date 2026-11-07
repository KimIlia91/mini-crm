import type { Database } from '@/shared/api'

export type AppRole = Database['public']['Enums']['app_role']

export interface Viewer {
  id: string
  role: AppRole
  fullName: string
  mustChangePassword: boolean
}

export interface Executor {
  id: string
  fullName: string
}
