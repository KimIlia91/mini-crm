import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

/** Sets a unique `document.title` per screen («Объекты — Mini-CRM»); an empty title leaves only the app name. */
export function useDocumentTitle(title: string): void {
  const { t } = useTranslation('common')
  const appName = t('appName')
  useEffect(() => {
    document.title = title === '' ? appName : `${title} — ${appName}`
  }, [title, appName])
}
