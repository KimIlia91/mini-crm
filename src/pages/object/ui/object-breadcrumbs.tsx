import { useQuery } from '@tanstack/react-query'
import { Building2Icon, MapPinIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Params } from 'react-router'

import { objectQueries, useCachedObjectName } from '@/entities/object'
import { listHref } from '@/shared/lib'
import { BreadcrumbTrail, type BreadcrumbTrailItem } from '@/shared/ui'

/** «Объекты › <имя объекта>»; reads the same query as the page, so it costs no extra request. */
export function ObjectBreadcrumbs({ params }: { params: Readonly<Params> }) {
  const { t } = useTranslation('object')
  const objectId = params.objectId ?? ''
  const object = useQuery({ ...objectQueries.detail(objectId), enabled: objectId !== '' })
  const cachedName = useCachedObjectName(objectId)
  const current: BreadcrumbTrailItem = { id: `object:${objectId}`, icon: MapPinIcon }
  const name = object.data?.name ?? cachedName
  if (name === undefined && object.isPending && objectId !== '') current.loading = true
  else current.label = name ?? t('crumbs.object')
  return (
    <BreadcrumbTrail
      items={[
        {
          id: 'objects',
          label: t('crumbs.objects'),
          to: listHref('/objects', 'objects'),
          icon: Building2Icon,
        },
        current,
      ]}
    />
  )
}
