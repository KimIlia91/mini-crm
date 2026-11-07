/*
 * Adapted from shadcn-admin (https://github.com/satnaing/shadcn-admin),
 * Copyright (c) 2024 Sat Naing, MIT License. See THIRD_PARTY_NOTICES.md.
 */
import { useTranslation } from 'react-i18next'
import { MoonIcon, SunIcon } from 'lucide-react'

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/shared/ui'

import { parseTheme, useTheme } from './theme-context'

/** Ghost icon button with a light / dark / system radio menu. */
export function ThemeSwitch() {
  const { theme, setTheme } = useTheme()
  const { t } = useTranslation('common')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label={t('theme.toggle')}>
          <SunIcon className="scale-100 rotate-0 transition-transform dark:scale-0 dark:-rotate-90" />
          <MoonIcon className="absolute scale-0 rotate-90 transition-transform dark:scale-100 dark:rotate-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            setTheme(parseTheme(value))
          }}
        >
          <DropdownMenuRadioItem value="light">{t('theme.light')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">{t('theme.dark')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">{t('theme.system')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
