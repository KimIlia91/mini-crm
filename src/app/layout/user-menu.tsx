/*
 * Adapted from shadcn-admin (https://github.com/satnaing/shadcn-admin),
 * Copyright (c) 2024 Sat Naing, MIT License. See THIRD_PARTY_NOTICES.md.
 */
import { useTranslation } from 'react-i18next'
import { LogOutIcon } from 'lucide-react'

import type { Viewer } from '@/entities/profile'
import { useTheme } from '@/shared/theme'
import {
  Avatar,
  AvatarFallback,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '@/shared/ui'

import { getInitials } from './initials'

/** Avatar with initials, full name and role; long names are cut with the full text in `title`. */
export function UserSummary({ viewer }: { viewer: Pick<Viewer, 'fullName' | 'role'> }) {
  const { t } = useTranslation('layout')
  return (
    <>
      <Avatar className="size-8 rounded-lg">
        <AvatarFallback className="rounded-lg text-foreground">
          {getInitials(viewer.fullName)}
        </AvatarFallback>
      </Avatar>
      <span className="grid min-w-0 flex-1 text-start text-sm leading-tight">
        <span className="truncate font-semibold" title={viewer.fullName}>
          {viewer.fullName}
        </span>
        <span className="truncate text-xs text-sidebar-foreground/75">
          {t(`role.${viewer.role}`)}
        </span>
      </span>
    </>
  )
}

interface UserMenuContentProps {
  viewer: Pick<Viewer, 'fullName' | 'role'>
  side?: 'top' | 'right' | 'bottom' | 'left'
  onSignOut: () => void
}

/** Menu body shared by the header avatar and the sidebar footer: who I am, theme, sign out. */
export function UserMenuContent({ viewer, side = 'bottom', onSignOut }: UserMenuContentProps) {
  const { t } = useTranslation('layout')
  const { t: tc } = useTranslation('common')
  const { theme, setTheme } = useTheme()
  return (
    <DropdownMenuContent
      align="end"
      side={side}
      sideOffset={4}
      className="max-w-[calc(100vw-1rem)] min-w-56 rounded-lg"
    >
      <DropdownMenuLabel className="flex items-center gap-2 px-1 py-1.5 font-normal">
        <UserSummary viewer={viewer} />
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-xs text-muted-foreground">
        {t('profile.theme')}
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={theme}
        onValueChange={(value) => {
          if (value === 'light' || value === 'dark' || value === 'system') setTheme(value)
        }}
      >
        <DropdownMenuRadioItem value="light">{tc('theme.light')}</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="dark">{tc('theme.dark')}</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="system">{tc('theme.system')}</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onSelect={onSignOut}>
        <LogOutIcon />
        {t('profile.signOut')}
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}
