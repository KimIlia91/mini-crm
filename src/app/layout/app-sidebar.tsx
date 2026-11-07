/*
 * Adapted from shadcn-admin (https://github.com/satnaing/shadcn-admin),
 * Copyright (c) 2024 Sat Naing, MIT License. See THIRD_PARTY_NOTICES.md.
 */
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useMatch } from 'react-router'
import { Building2Icon } from 'lucide-react'

import type { Viewer } from '@/entities/profile'
import { listHref, sanitizeListSearch } from '@/shared/lib'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/shared/ui'

import { NAV_ITEMS, type NavItem } from './nav-items'
import { NavUser } from './nav-user'

function NavLinkItem({ item }: { item: NavItem }) {
  const { t } = useTranslation('layout')
  const { setOpenMobile } = useSidebar()
  const isActive = useMatch({ path: item.to, end: false }) !== null
  const { search } = useLocation()
  const onList = useMatch({ path: item.to, end: true }) !== null
  const liveSearch = onList ? sanitizeListSearch(search) : ''
  const href = onList
    ? liveSearch === ''
      ? item.to
      : `${item.to}?${liveSearch}`
    : listHref(item.to, item.listKey)
  const Icon = item.icon
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={t(item.labelKey)}>
        <Link
          to={href}
          aria-current={isActive ? 'page' : undefined}
          onClick={() => {
            setOpenMobile(false)
          }}
        >
          <Icon aria-hidden="true" />
          <span>{t(item.labelKey)}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

/** Collapsible inset sidebar: brand, role-based navigation, current user. */
export function AppSidebar({ viewer }: { viewer: Viewer }) {
  const { t } = useTranslation('layout')
  const { t: tc } = useTranslation('common')
  const items = NAV_ITEMS.filter((item) => item.roles.includes(viewer.role))
  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/">
                <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Building2Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="text-base font-semibold">{tc('appName')}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label={t('nav.label')}>
          <SidebarGroup>
            <SidebarGroupLabel>{t('nav.group')}</SidebarGroupLabel>
            <SidebarMenu>
              {items.map((item) => (
                <NavLinkItem key={item.to} item={item} />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <NavUser viewer={viewer} />
      </SidebarFooter>
    </Sidebar>
  )
}
