import { useQuery } from '@tanstack/react-query'
import { BellIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'

import {
  formatUnreadCount,
  NOTIFICATION_PAGE_SIZE,
  nextNotificationLimit,
  NotificationItem,
  notificationQueries,
  useMarkAllNotificationsRead,
  useNotificationText,
  type AppNotification,
} from '@/entities/notification'
import {
  Alert,
  AlertDescription,
  Button,
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  Spinner,
} from '@/shared/ui'

import { useOpenNotification } from '../realtime/open-notification'

/** Bell with the unread counter and a popover list of the viewer's notifications. */
export function NotificationsMenu() {
  const { t } = useTranslation('layout')
  const text = useNotificationText()
  const openNotification = useOpenNotification()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [limit, setLimit] = useState(NOTIFICATION_PAGE_SIZE)
  const leavingPage = useRef(false)
  const listEl = useRef<HTMLUListElement>(null)
  /** Number of items shown when «Показать ещё» was pressed; focus moves to the first new one. */
  const focusFrom = useRef<number | null>(null)

  const unreadQuery = useQuery(notificationQueries.unreadCount())
  const items = useQuery({ ...notificationQueries.list(limit), enabled: open })
  const markAllRead = useMarkAllNotificationsRead()

  const unread = unreadQuery.data ?? 0
  const label =
    unread > 0
      ? t('notifications.bellUnread', { unread: formatUnreadCount(unread) })
      : t('notifications.bell')
  const nextLimit = items.data ? nextNotificationLimit(limit, items.data.total) : null

  useEffect(() => {
    const from = focusFrom.current
    if (from === null || !items.data || items.data.items.length <= from) return
    focusFrom.current = null
    listEl.current?.querySelectorAll('li')[from]?.querySelector('button')?.focus()
  }, [items.data])

  const select = (notification: AppNotification) => {
    const link = openNotification(notification)
    if (link === null) return
    // Focus then goes to the new page content instead of back to the bell.
    leavingPage.current = link !== pathname
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setLimit(NOTIFICATION_PAGE_SIZE)
          focusFrom.current = null
          markAllRead.reset()
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative rounded-full max-[768px]:size-11"
          aria-label={label}
        >
          <BellIcon />
          {unread > 0 ? (
            <span
              aria-hidden="true"
              className="absolute top-0 right-0 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-primary px-1 text-[0.6875rem] leading-none font-semibold text-primary-foreground"
            >
              {formatUnreadCount(unread)}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={t('notifications.title')}
        className="gap-0 p-0"
        onCloseAutoFocus={(event) => {
          if (leavingPage.current) event.preventDefault()
          leavingPage.current = false
        }}
      >
        <PopoverHeader className="flex-row items-center justify-between gap-2 border-b p-3">
          <PopoverTitle>{t('notifications.title')}</PopoverTitle>
          <Button
            variant="ghost"
            size="sm"
            // aria-disabled, not disabled: a pressed button that becomes disabled loses the focus, and
            // the non-modal popover would close as focus-outside (seen on touch).
            aria-disabled={unread === 0 || markAllRead.isPending}
            className="aria-disabled:cursor-default aria-disabled:opacity-50 max-[768px]:h-11"
            onClick={() => {
              if (unread === 0 || markAllRead.isPending) return
              markAllRead.mutate()
            }}
          >
            {t('notifications.markAllRead')}
          </Button>
        </PopoverHeader>
        {/* Always in the tree, so screen readers announce the text when it appears. */}
        <div
          role="status"
          className="text-sm text-muted-foreground has-[span]:px-3 has-[span]:pt-2"
        >
          {markAllRead.isPaused ? (
            <span>{t('notifications.offline')}</span>
          ) : markAllRead.isSuccess ? (
            <span>{t('notifications.allRead')}</span>
          ) : null}
        </div>
        {markAllRead.isError ? (
          <div className="p-3 pb-0">
            <Alert variant="destructive">
              <AlertDescription>{t('notifications.markAllFailed')}</AlertDescription>
            </Alert>
          </div>
        ) : null}
        {items.isPending ? (
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        ) : items.isError && items.data === undefined ? (
          <div className="p-3">
            <Alert variant="destructive">
              <AlertDescription className="flex flex-col items-start gap-2">
                {t('notifications.loadFailed')}
                <Button
                  variant="outline"
                  size="sm"
                  className="max-[768px]:h-11"
                  onClick={() => {
                    void items.refetch()
                  }}
                >
                  {t('notifications.retry')}
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        ) : items.data.items.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {t('notifications.empty')}
          </p>
        ) : (
          <div className="max-h-[min(70dvh,24rem)] overflow-y-auto p-1">
            <ul
              ref={listEl}
              aria-label={t('notifications.listLabel')}
              className="flex flex-col gap-0.5"
            >
              {items.data.items.map((n) => (
                <li key={n.id}>
                  <NotificationItem
                    title={n.title}
                    description={text.describe(n)}
                    actorName={n.actorName ?? undefined}
                    createdAt={n.createdAt}
                    unread={!n.read}
                    resolutionText={text.resolve(n)}
                    onSelect={() => {
                      select(n)
                    }}
                  />
                </li>
              ))}
            </ul>
            {nextLimit !== null ? (
              <div className="flex justify-center p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="max-[768px]:h-11"
                  // aria-disabled, not disabled: the button keeps focus while the next page loads.
                  aria-disabled={items.isFetching}
                  onClick={() => {
                    if (items.isFetching) return
                    focusFrom.current = items.data.items.length
                    setLimit(nextLimit)
                  }}
                >
                  {t('notifications.showMore')}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
