/*
 * Adapted from shadcn-admin (https://github.com/satnaing/shadcn-admin),
 * Copyright (c) 2024 Sat Naing, MIT License. See THIRD_PARTY_NOTICES.md.
 */
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'

import { useDocumentTitle } from '@/shared/lib'
import { Button } from '@/shared/ui'

export function NotFoundPage() {
  const { t } = useTranslation('not-found')
  const navigate = useNavigate()
  useDocumentTitle(t('title'))
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col items-center justify-center gap-2 p-6 text-center">
      <p aria-hidden="true" className="text-[7rem] leading-tight font-bold">
        {t('code')}
      </p>
      <h1 className="text-2xl font-medium">{t('title')}</h1>
      <p className="text-muted-foreground">{t('description')}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-4">
        <Button
          variant="outline"
          onClick={() => {
            void navigate(-1)
          }}
        >
          {t('back')}
        </Button>
        <Button asChild>
          <Link to="/">{t('home')}</Link>
        </Button>
      </div>
    </main>
  )
}
