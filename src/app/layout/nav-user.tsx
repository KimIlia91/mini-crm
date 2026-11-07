/*
 * Adapted from shadcn-admin (https://github.com/satnaing/shadcn-admin),
 * Copyright (c) 2024 Sat Naing, MIT License. See THIRD_PARTY_NOTICES.md.
 */
import { useState } from 'react'
import { ChevronsUpDownIcon } from 'lucide-react'

import type { Viewer } from '@/entities/profile'
import { SignOutDialog } from '@/shared/auth'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/shared/ui'

import { UserMenuContent, UserSummary } from './user-menu'

/** Sidebar footer: current user with the same menu as the header avatar. */
export function NavUser({ viewer }: { viewer: Viewer }) {
  const { isMobile } = useSidebar()
  const [signOutOpen, setSignOutOpen] = useState(false)
  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <UserSummary viewer={viewer} />
                <ChevronsUpDownIcon className="ms-auto size-4" aria-hidden="true" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <UserMenuContent
              viewer={viewer}
              side={isMobile ? 'bottom' : 'right'}
              onSignOut={() => {
                setSignOutOpen(true)
              }}
            />
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} />
    </>
  )
}
