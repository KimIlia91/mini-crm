import type { ComponentType } from 'react'
import type { Params } from 'react-router'

import type { layoutRu } from '../i18n/ru-layout'

export type CrumbKey = `crumbs.${keyof typeof layoutRu.crumbs}`

export interface Crumb {
  id: string
  labelKey: CrumbKey
  to?: string
}

/** Breadcrumbs known without data. */
export interface StaticRouteHandle {
  crumbs: readonly Crumb[]
}

/** Breadcrumbs that need the page's data: the page slice supplies the component (it owns the query). */
export interface DynamicRouteHandle {
  Breadcrumbs: ComponentType<{ params: Readonly<Params> }>
}

/** Attached to routes as `handle`; the header renders it as breadcrumbs. */
export type RouteHandle = StaticRouteHandle | DynamicRouteHandle

export function isRouteHandle(value: unknown): value is RouteHandle {
  return (
    typeof value === 'object' && value !== null && ('crumbs' in value || 'Breadcrumbs' in value)
  )
}
