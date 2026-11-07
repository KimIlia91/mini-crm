/*
 * Adapted from shadcn-admin (https://github.com/satnaing/shadcn-admin),
 * Copyright (c) 2024 Sat Naing, MIT License. See THIRD_PARTY_NOTICES.md.
 */

import { useTranslation } from 'react-i18next'

/**
 * First focusable element of the page. The target needs `id="main-content"` and `tabIndex={-1}`
 * so focus actually moves there.
 */
export function SkipToMain() {
  const { t } = useTranslation('common')
  return (
    <a
      href="#main-content"
      className="sr-only rounded-md bg-primary text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-[100] focus:px-4 focus:py-2 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {t('skipToMain')}
    </a>
  )
}
