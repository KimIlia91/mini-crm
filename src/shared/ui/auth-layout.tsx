/*
 * Adapted from shadcn-admin (https://github.com/satnaing/shadcn-admin),
 * Copyright (c) 2024 Sat Naing, MIT License. See THIRD_PARTY_NOTICES.md.
 */
import { useTranslation } from 'react-i18next'
import { Building2Icon } from 'lucide-react'

/**
 * Decorative drafting-sheet backdrop: a fading survey grid, a faint floor-plan outline and one
 * slow-drifting soft light. Pure CSS/inline SVG on theme tokens; the drift is transform-only and
 * disabled under prefers-reduced-motion.
 */
function AuthBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0 text-foreground/[0.07] dark:text-foreground/[0.09]"
        style={{
          backgroundImage:
            'linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse 70% 60% at 50% 45%, #000 20%, transparent 100%)',
        }}
      />
      <div className="absolute -top-1/4 -left-1/4 size-[70vmax] rounded-full bg-[radial-gradient(closest-side,var(--color-primary)_0%,transparent_100%)] opacity-[0.04] motion-safe:animate-[auth-drift_40s_ease-in-out_infinite_alternate] dark:opacity-[0.12]" />
      <svg
        viewBox="0 0 480 360"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="square"
        className="absolute -right-16 -bottom-10 w-[28rem] max-w-none text-foreground/[0.12] sm:w-[40rem] dark:text-foreground/[0.16]"
      >
        <path d="M20 20h300v140h140v180H20zM320 160h-90M20 200h140M160 200v140M320 340V230" />
        <path d="M120 20v50M200 20v50" strokeDasharray="4 6" />
        <path d="M20 8h300M20 4v8M320 4v8" strokeWidth="1" />
        <path d="M472 160v180M468 160h8M468 340h8" strokeWidth="1" />
      </svg>
    </div>
  )
}

/** Centered column for the sign-in and change-password cards: brand row, then the card. */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('common')
  return (
    <div className="relative isolate min-h-svh overflow-hidden">
      <AuthBackdrop />
      <main className="mx-auto flex min-h-svh w-full max-w-sm flex-col items-center justify-center gap-6 p-4">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Building2Icon className="size-5" aria-hidden="true" />
          </span>
          <span className="text-xl font-medium">{t('appName')}</span>
        </div>
        {children}
      </main>
    </div>
  )
}
