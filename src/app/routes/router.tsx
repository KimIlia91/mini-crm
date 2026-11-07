import { createBrowserRouter, type RouteObject } from 'react-router'

import { ChangePasswordPage } from '@/pages/change-password'
import { LoginPage } from '@/pages/login'
import { MyTasksPage } from '@/pages/my-tasks'
import { NotFoundPage } from '@/pages/not-found'
import { ObjectBreadcrumbs, ObjectPage } from '@/pages/object'
import { ObjectsPage } from '@/pages/objects'
import { TaskBreadcrumbs, TaskPage } from '@/pages/task'

import { AppLayout } from './app-layout'
import { HomeRedirect } from './home-redirect'
import { CHANGE_PASSWORD_PATH, RequireAuth } from './require-auth'
import { RequireRole } from './require-role'
import type { RouteHandle } from './route-handle'

const objectsHandle: RouteHandle = { crumbs: [{ id: 'objects', labelKey: 'crumbs.objects' }] }
const objectHandle: RouteHandle = { Breadcrumbs: ObjectBreadcrumbs }
const taskHandle: RouteHandle = { Breadcrumbs: TaskBreadcrumbs }
const myTasksHandle: RouteHandle = { crumbs: [{ id: 'my-tasks', labelKey: 'crumbs.myTasks' }] }

/**
 * All routes are registered here once. Pages are imported eagerly: their translation bundles are
 * registered by `app/i18n` through the same public APIs, so a lazy chunk would not be split anyway.
 */
export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: CHANGE_PASSWORD_PATH, element: <ChangePasswordPage /> },
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <HomeRedirect /> },
          { path: 'objects', element: <ObjectsPage />, handle: objectsHandle },
          { path: 'objects/:objectId', element: <ObjectPage />, handle: objectHandle },
          { path: 'tasks/:taskId', element: <TaskPage />, handle: taskHandle },
          {
            element: <RequireRole role="executor" />,
            children: [{ path: 'my-tasks', element: <MyTasksPage />, handle: myTasksHandle }],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]

export const router = createBrowserRouter(routes)
