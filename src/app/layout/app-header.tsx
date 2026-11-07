/*
 * Adapted from shadcn-admin (https://github.com/satnaing/shadcn-admin),
 * Copyright (c) 2024 Sat Naing, MIT License. See THIRD_PARTY_NOTICES.md.
 */
import { useTranslation } from 'react-i18next'
import { useMatches } from 'react-router'

import type { Viewer } from '@/entities/profile'
import { ThemeSwitch } from '@/shared/theme'
import { BreadcrumbTrail, BreadcrumbTrailHost, Separator, SidebarTrigger } from '@/shared/ui'

import { isRouteHandle } from '../routes/route-handle'
import { ProfileDropdown } from './profile-dropdown'

/** Breadcrumbs of the deepest matched route that declares them. */
function Breadcrumbs() {
  const { t } = useTranslation('layout')
  const matches = useMatches()
  for (const match of matches.toReversed()) {
    const handle = match.handle
    if (!isRouteHandle(handle)) continue
    if ('Breadcrumbs' in handle) return <handle.Breadcrumbs params={match.params} />
    return (
      <BreadcrumbTrail
        items={handle.crumbs.map((crumb) => ({
          id: crumb.id,
          label: t(crumb.labelKey),
          to: crumb.to,
        }))}
      />
    )
  }
  return null
}

/** Top bar of the inset layout: sidebar trigger, breadcrumbs, theme switch, profile menu. */
export function AppHeader({ viewer }: { viewer: Viewer }) {
  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:gap-4 sm:px-4 md:rounded-t-xl">
      <SidebarTrigger variant="outline" className="max-md:size-9" />
      <Separator orientation="vertical" className="h-6" />
      <BreadcrumbTrailHost>
        <Breadcrumbs />
      </BreadcrumbTrailHost>
      <div className="ms-auto flex shrink-0 items-center gap-1">
        <ThemeSwitch />
        <ProfileDropdown viewer={viewer} />
      </div>
    </header>
  )
}
