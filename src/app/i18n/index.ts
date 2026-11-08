import { entityNotificationRu } from '@/entities/notification'
import { entityTaskRu } from '@/entities/task'
import { manageObjectRu } from '@/features/manage-object'
import { manageTaskRu } from '@/features/manage-task'
import { aboutRu } from '@/pages/about'
import { changePasswordRu } from '@/pages/change-password'
import { loginRu } from '@/pages/login'
import { myTasksRu } from '@/pages/my-tasks'
import { notFoundRu } from '@/pages/not-found'
import { objectRu } from '@/pages/object'
import { objectsRu } from '@/pages/objects'
import { taskRu } from '@/pages/task'
import { commonRu, DEFAULT_LANGUAGE, i18n } from '@/shared/i18n'

import { layoutRu } from './ru-layout'

/** Every namespace of the app; the single source of the typed translation keys. */
export const resources = {
  common: commonRu,
  layout: layoutRu,
  'entity-notification': entityNotificationRu,
  'entity-task': entityTaskRu,
  'manage-object': manageObjectRu,
  'manage-task': manageTaskRu,
  login: loginRu,
  'change-password': changePasswordRu,
  'not-found': notFoundRu,
  objects: objectsRu,
  object: objectRu,
  task: taskRu,
  'my-tasks': myTasksRu,
  about: aboutRu,
} as const

for (const [namespace, bundle] of Object.entries(resources)) {
  i18n.addResourceBundle(DEFAULT_LANGUAGE, namespace, bundle, true, true)
}

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: typeof resources
  }
}
