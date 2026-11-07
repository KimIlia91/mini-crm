import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

import { commonRu } from './ru-common'

export const DEFAULT_LANGUAGE = 'ru'
export const DEFAULT_NAMESPACE = 'common'

/**
 * The single i18next instance. Initialised synchronously with static resources (no backend);
 * `app` adds slice namespaces with `i18n.addResourceBundle(lng, ns, resources, true, true)`.
 */
export const i18n = i18next.createInstance()

void i18n.use(initReactI18next).init({
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  defaultNS: DEFAULT_NAMESPACE,
  ns: [DEFAULT_NAMESPACE],
  resources: { [DEFAULT_LANGUAGE]: { [DEFAULT_NAMESPACE]: commonRu } },
  interpolation: { escapeValue: false },
  returnNull: false,
})
