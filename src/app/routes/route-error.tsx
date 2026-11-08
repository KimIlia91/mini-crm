import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { cn, useDocumentTitle } from '@/shared/lib'
import { Button } from '@/shared/ui'

/**
 * `errorElement` of the routes: a page that crashed while rendering. React reports the error to
 * the console itself; the user gets a plain message, never the error text. Navigating away clears
 * the error. `inShell` renders inside the app layout (its `main`), keeping the header and sidebar.
 */
export function RouteError({ inShell = false }: { inShell?: boolean }) {
  const { t } = useTranslation('layout')
  useDocumentTitle(t('routeError.documentTitle'))
  const Root = inShell ? 'div' : 'main'
  return (
    <Root
      className={cn(
        'mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-2 text-center',
        inShell ? 'py-12' : 'min-h-svh p-6',
      )}
    >
      <h1 className="text-2xl font-medium">{t('routeError.title')}</h1>
      <p className="text-muted-foreground">{t('routeError.description')}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            window.location.reload()
          }}
        >
          {t('routeError.reload')}
        </Button>
        <Button asChild>
          <Link to="/">{t('routeError.home')}</Link>
        </Button>
      </div>
    </Root>
  )
}
