import type { CSSProperties } from 'react'
import { Toaster as Sonner, toast, type ToasterProps } from 'sonner'
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from 'lucide-react'
import { useTheme } from '@/shared/theme'
import { cn } from 'cn'

/**
 * Toast host. Bottom-right on desktop; below 600 px sonner itself switches to full-width
 * bottom-centre, so the sticky header and form fields at 320 px stay uncovered.
 * Motion is covered by the global prefers-reduced-motion rule; aria-live comes from sonner.
 */
function Toaster({ toastOptions, ...props }: ToasterProps) {
  const { resolvedTheme } = useTheme()

  return (
    <Sonner
      theme={resolvedTheme}
      position="bottom-right"
      closeButton
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as CSSProperties
      }
      {...props}
      toastOptions={{
        ...toastOptions,
        classNames: {
          ...toastOptions?.classNames,
          toast: cn('cn-toast pr-10!', toastOptions?.classNames?.toast),
          title: cn(
            'line-clamp-2 max-h-12 [overflow-wrap:anywhere]',
            toastOptions?.classNames?.title,
          ),
          description: cn(
            'line-clamp-2 max-h-12 [overflow-wrap:anywhere]',
            toastOptions?.classNames?.description,
          ),
          actionButton: cn(
            'max-md:h-11! pointer-coarse:h-11!',
            toastOptions?.classNames?.actionButton,
          ),
          closeButton: cn(
            'top-1.5! right-1.5! left-auto! transform-none!',
            'size-6!',
            'max-md:after:absolute max-md:after:-inset-2.5 max-md:after:content-[""] pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5 pointer-coarse:after:content-[""]',
            'bg-popover! border-border! text-popover-foreground!',
            'focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!',
            toastOptions?.classNames?.closeButton,
          ),
        },
      }}
    />
  )
}

export { Toaster, toast }
