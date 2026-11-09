import { useQuery } from '@tanstack/react-query'
import { Building2Icon, ClipboardListIcon, MapPinIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Params } from 'react-router'

import { taskQueries, useCachedTaskTitle } from '@/entities/task'
import { listHref } from '@/shared/lib'
import { BreadcrumbTrail, type BreadcrumbTrailItem } from '@/shared/ui'

/**
 * «Объекты › <объект> › <задача>» with the object as a link. Reads the same query as the page (the
 * task embeds its object). While it loads, the object crumb stays as the previous page showed it
 * and the task crumb is a placeholder; when the task is unavailable, neutral labels remain.
 */
export function TaskBreadcrumbs({ params }: { params: Readonly<Params> }) {
  const { t } = useTranslation('task')
  const taskId = params.taskId ?? ''
  const task = useQuery({ ...taskQueries.detail(taskId), enabled: taskId !== '' })
  const cachedTitle = useCachedTaskTitle(taskId)
  const taskCrumbId = `task:${taskId}`
  const items: BreadcrumbTrailItem[] = [
    {
      id: 'objects',
      label: t('crumbs.objects'),
      to: listHref('/objects', 'objects'),
      icon: Building2Icon,
    },
  ]
  if (task.isPending && taskId !== '') {
    items.push(
      { id: 'task-object', loading: true, keepPrevious: true, icon: MapPinIcon },
      cachedTitle === undefined
        ? { id: taskCrumbId, loading: true, icon: ClipboardListIcon }
        : { id: taskCrumbId, label: cachedTitle, icon: ClipboardListIcon },
    )
  } else if (task.data) {
    items.push(
      {
        id: `object:${task.data.object.id}`,
        label: task.data.object.name,
        to: listHref(`/objects/${task.data.object.id}`, `object:${task.data.object.id}`),
        icon: MapPinIcon,
      },
      { id: taskCrumbId, label: task.data.title, icon: ClipboardListIcon },
    )
  } else {
    items.push({ id: taskCrumbId, label: t('crumbs.task'), icon: ClipboardListIcon })
  }
  return <BreadcrumbTrail items={items} />
}
