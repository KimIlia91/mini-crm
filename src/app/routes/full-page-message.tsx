import type { ReactNode } from 'react'

export function FullPageMessage({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <p role="status" className="text-muted-foreground">
        {children}
      </p>
    </main>
  )
}
