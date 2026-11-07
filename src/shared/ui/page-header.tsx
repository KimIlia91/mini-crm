import { cn } from '@/shared/lib/utils'

interface PageHeaderProps {
  /** The only `h1` of the screen. */
  title: string
  description?: React.ReactNode
  /** Rendered next to the title (e.g. a status badge). */
  titleSuffix?: React.ReactNode
  /** Primary and secondary buttons, aligned to the end. */
  actions?: React.ReactNode
  /**
   * The title and description are user data of any length: show at most two lines each, with the
   * full text in `title`. Static texts must not set this (no tooltip repeating the visible text).
   */
  clamp?: boolean
  className?: string
}

/** Screen heading: title (24px/700), muted description and a wrapping actions group. */
export function PageHeader({
  title,
  description,
  titleSuffix,
  actions,
  clamp = false,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-wrap items-start justify-between gap-x-4 gap-y-2',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1
            className={cn(
              'min-w-0 text-2xl font-bold tracking-tight [overflow-wrap:anywhere]',
              clamp && 'line-clamp-2',
            )}
            title={clamp ? title : undefined}
          >
            {title}
          </h1>
          {titleSuffix}
        </div>
        {description ? (
          <p
            className={cn(
              '[overflow-wrap:anywhere] text-muted-foreground',
              clamp && 'line-clamp-2',
            )}
            title={clamp && typeof description === 'string' ? description : undefined}
          >
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
