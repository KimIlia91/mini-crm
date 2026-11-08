import { useTranslation } from 'react-i18next'
import { cn, formatDateTime, formatDateTimeFull } from '@/shared/lib'

export interface NotificationItemProps {
  title: string
  description: string
  actorName?: string
  createdAt: string | Date
  unread: boolean
  resolutionText?: string
  onSelect: () => void
}

export function NotificationItem({
  title,
  description,
  actorName,
  createdAt,
  unread,
  resolutionText,
  onSelect,
}: NotificationItemProps) {
  const { t } = useTranslation('entity-notification')

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex min-h-11 w-full cursor-pointer items-start gap-3 rounded-md px-3 py-2 text-left text-sm outline-none',
        'hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
        unread && 'bg-accent/40',
      )}
    >
      <span
        className="mt-1.5 flex size-2 shrink-0 items-center justify-center"
        aria-hidden={!unread}
      >
        {unread ? (
          <>
            <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
            <span className="sr-only">{t('item.unread')}</span>
          </>
        ) : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            'line-clamp-2 [overflow-wrap:anywhere]',
            unread ? 'font-semibold' : 'font-medium',
          )}
          title={title}
        >
          {title}
        </span>
        <span
          className="line-clamp-3 [overflow-wrap:anywhere] text-muted-foreground"
          title={actorName ? `${actorName}: ${description}` : description}
        >
          {actorName ? `${actorName}: ${description}` : description}
        </span>
        {resolutionText ? (
          <span className="text-xs [overflow-wrap:anywhere] text-muted-foreground">
            {resolutionText}
          </span>
        ) : null}
        <time
          dateTime={new Date(createdAt).toISOString()}
          title={formatDateTimeFull(createdAt)}
          className="text-xs text-muted-foreground"
        >
          {formatDateTime(createdAt)}
        </time>
      </span>
    </button>
  )
}
