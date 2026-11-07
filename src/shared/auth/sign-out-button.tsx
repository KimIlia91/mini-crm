import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { signOut } from '@/shared/api'
import { Button } from '@/shared/ui'

/** Direct sign-out button; the app shell uses `SignOutDialog` from its user menu instead. */
export function SignOutButton() {
  const { t } = useTranslation('common')
  const mutation = useMutation({ mutationFn: signOut })
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      {mutation.isError ? (
        <span role="alert" className="text-sm text-destructive">
          {t('signOut.error')}
        </span>
      ) : null}
      <Button
        type="button"
        variant="outline"
        disabled={mutation.isPending}
        onClick={() => {
          mutation.mutate()
        }}
      >
        {t('signOut.confirm')}
      </Button>
    </span>
  )
}
