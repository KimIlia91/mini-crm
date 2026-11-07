/*
 * Adapted from shadcn-admin (https://github.com/satnaing/shadcn-admin),
 * Copyright (c) 2024 Sat Naing, MIT License. See THIRD_PARTY_NOTICES.md.
 */
import { useTranslation } from 'react-i18next'

import { SignOutButton } from '@/shared/auth'
import { useDocumentTitle } from '@/shared/lib'
import { Button } from '@/shared/ui'

/** Shown when the profile is missing (no access) or could not be loaded. */
export function NoAccess({ failed = false, onRetry }: { failed?: boolean; onRetry?: () => void }) {
  const { t } = useTranslation('layout')
  const title = failed ? t('noAccess.failedTitle') : t('noAccess.title')
  useDocumentTitle(title)
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col items-center justify-center gap-2 p-6 text-center">
      {failed ? null : (
        <p aria-hidden="true" className="text-[7rem] leading-tight font-bold">
          {t('noAccess.code')}
        </p>
      )}
      <h1 className="text-2xl font-medium [overflow-wrap:anywhere]">{title}</h1>
      <p className="text-muted-foreground">
        {failed ? t('noAccess.failedDescription') : t('noAccess.description')}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-4">
        {failed && onRetry ? (
          <Button type="button" onClick={onRetry}>
            {t('noAccess.retry')}
          </Button>
        ) : null}
        <SignOutButton />
      </div>
    </main>
  )
}
