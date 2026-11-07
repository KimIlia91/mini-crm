/*
 * Adapted from shadcn-admin (https://github.com/satnaing/shadcn-admin),
 * Copyright (c) 2024 Sat Naing, MIT License. See THIRD_PARTY_NOTICES.md.
 */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Viewer } from '@/entities/profile'
import { SignOutDialog } from '@/shared/auth'
import { useReturnFocus } from '@/shared/lib'
import { Avatar, AvatarFallback, Button, DropdownMenu, DropdownMenuTrigger } from '@/shared/ui'

import { getInitials } from './initials'
import { UserMenuContent } from './user-menu'

/** Header avatar button opening the profile menu. */
export function ProfileDropdown({ viewer }: { viewer: Viewer }) {
  const { t } = useTranslation('layout')
  const [signOutOpen, setSignOutOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const { remember, onCloseAutoFocus } = useReturnFocus()
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button ref={opener} variant="ghost" size="icon" className="rounded-full">
            <span className="sr-only">{t('profile.menu', { name: viewer.fullName })}</span>
            <Avatar className="size-8" aria-hidden="true">
              <AvatarFallback className="text-foreground">
                {getInitials(viewer.fullName)}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <UserMenuContent
          viewer={viewer}
          onSignOut={() => {
            remember(opener.current)
            setSignOutOpen(true)
          }}
        />
      </DropdownMenu>
      <SignOutDialog
        open={signOutOpen}
        onOpenChange={setSignOutOpen}
        onCloseAutoFocus={onCloseAutoFocus}
      />
    </>
  )
}
