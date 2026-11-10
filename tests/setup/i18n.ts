import { DEFAULT_LANGUAGE, i18n } from '../../src/shared/i18n'
import { layoutRu } from '../../src/app/i18n/ru-layout'
import { entityNotificationRu } from '../../src/entities/notification/i18n/ru'
import { entityTaskRu } from '../../src/entities/task/i18n/ru'
import { manageObjectRu } from '../../src/features/manage-object/i18n/ru'
import { manageTaskRu } from '../../src/features/manage-task/i18n/ru'
import { transitionCommentRu } from '../../src/features/transition-comment/i18n/ru'
import { aboutRu } from '../../src/pages/about/i18n/ru'
import { boardRu } from '../../src/pages/board/i18n/ru'
import { changePasswordRu } from '../../src/pages/change-password/i18n/ru'
import { loginRu } from '../../src/pages/login/i18n/ru'
import { myTasksRu } from '../../src/pages/my-tasks/i18n/ru'
import { notFoundRu } from '../../src/pages/not-found/i18n/ru'
import { objectRu } from '../../src/pages/object/i18n/ru'
import { objectsRu } from '../../src/pages/objects/i18n/ru'
import { taskRu } from '../../src/pages/task/i18n/ru'

/**
 * Registers every slice namespace for component tests, which render slices without the app shell.
 * Keep in sync with src/app/i18n/index.ts.
 */
const bundles = {
  layout: layoutRu,
  'entity-notification': entityNotificationRu,
  'entity-task': entityTaskRu,
  'manage-object': manageObjectRu,
  'manage-task': manageTaskRu,
  'transition-comment': transitionCommentRu,
  board: boardRu,
  login: loginRu,
  'change-password': changePasswordRu,
  'not-found': notFoundRu,
  objects: objectsRu,
  object: objectRu,
  task: taskRu,
  'my-tasks': myTasksRu,
  about: aboutRu,
}

for (const [namespace, bundle] of Object.entries(bundles)) {
  i18n.addResourceBundle(DEFAULT_LANGUAGE, namespace, bundle, true, true)
}
