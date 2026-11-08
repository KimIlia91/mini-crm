/*
 * Adapted from shadcn-admin (https://github.com/satnaing/shadcn-admin),
 * Copyright (c) 2024 Sat Naing, MIT License. See THIRD_PARTY_NOTICES.md.
 */
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  NavigationType,
  UNSAFE_LocationContext as LocationContext,
  useLocation,
  useNavigationType,
  useOutlet,
} from 'react-router'

import { useViewer } from '@/entities/profile'
import {
  PageTransition,
  SidebarInset,
  SidebarProvider,
  SkipToMain,
  Toaster,
  TooltipProvider,
} from '@/shared/ui'

import { AppHeader } from '../layout/app-header'
import { AppSidebar } from '../layout/app-sidebar'
import { useNotificationToasts } from '../realtime/notification-toasts'
import { useRealtimeSync } from '../realtime/use-realtime-sync'

/** The sidebar keeps its state in this cookie (written by SidebarProvider). */
function readSidebarOpen(): boolean {
  return !document.cookie.split('; ').includes('sidebar_state=false')
}

/** Inset shell for signed-in screens; `main` is the skip-link target. */
export function AppLayout() {
  const { t } = useTranslation('layout')
  const viewer = useViewer()
  useRealtimeSync(viewer, useNotificationToasts(viewer.id))
  const location = useLocation()
  const navigationType = useNavigationType()
  const outlet = useOutlet()
  const { pathname } = location
  const main = useRef<HTMLElement>(null)
  const focusMain = () => {
    const active = document.activeElement
    if (!active || active === document.body) main.current?.focus({ preventScroll: true })
  }
  const resetScroll = () => {
    if (main.current) main.current.scrollTop = 0
    if (navigationType !== NavigationType.Pop) window.scrollTo(0, 0)
  }
  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={readSidebarOpen()}>
        <SkipToMain />
        <AppSidebar viewer={viewer} />
        <SidebarInset className="min-w-0 fit-screen:h-[calc(100svh-1rem)] fit-screen:overflow-hidden">
          <AppHeader viewer={viewer} />
          <main
            ref={main}
            id="main-content"
            tabIndex={-1}
            className="flex min-w-0 flex-1 flex-col gap-4 px-4 pt-4 pb-6 outline-none sm:gap-6 fit-screen:min-h-0 fit-screen:overflow-y-auto"
          >
            <PageTransition
              transitionKey={pathname}
              onEntered={focusMain}
              onExited={resetScroll}
              className="flex min-w-0 flex-1 flex-col fit-screen:min-h-0"
            >
              <LocationContext value={{ location, navigationType }}>{outlet}</LocationContext>
            </PageTransition>
          </main>
        </SidebarInset>
      </SidebarProvider>
      <Toaster
        containerAriaLabel={t('notifications.region')}
        toastOptions={{ closeButtonAriaLabel: t('notifications.toastClose') }}
      />
    </TooltipProvider>
  )
}
