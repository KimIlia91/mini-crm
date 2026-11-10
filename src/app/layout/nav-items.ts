import { Building2Icon, KanbanIcon, ListChecksIcon, type LucideIcon } from 'lucide-react'

import type { AppRole } from '@/entities/profile'

export interface NavItem {
  to: string
  listKey: string
  labelKey: 'nav.objects' | 'nav.myTasks' | 'nav.board'
  icon: LucideIcon
  roles: readonly AppRole[]
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    to: '/objects',
    listKey: 'objects',
    labelKey: 'nav.objects',
    icon: Building2Icon,
    roles: ['manager', 'executor'],
  },
  {
    to: '/my-tasks',
    listKey: 'my-tasks',
    labelKey: 'nav.myTasks',
    icon: ListChecksIcon,
    roles: ['executor'],
  },
  {
    to: '/board',
    listKey: 'board',
    labelKey: 'nav.board',
    icon: KanbanIcon,
    roles: ['manager', 'executor'],
  },
]
