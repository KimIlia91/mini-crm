import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { signOut } from '@/shared/api'
import { Alert, AlertDescription, ConfirmDialog } from '@/shared/ui'

interface SignOutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
}

/** Confirms sign-out; a failure stays visible inside the dialog. */
export function SignOutDialog({ open, onOpenChange, onCloseAutoFocus }: SignOutDialogProps) {
  const { t } = useTranslation('common')
  const mutation = useMutation({ mutationFn: signOut })
  return (
    <ConfirmDialog
      open={open}
      onCloseAutoFocus={onCloseAutoFocus}
      onOpenChange={(next) => {
        if (!next) mutation.reset()
        onOpenChange(next)
      }}
      title={t('signOut.title')}
      description={t('signOut.description')}
      confirmText={t('signOut.confirm')}
      isPending={mutation.isPending}
      onConfirm={() => {
        mutation.mutate()
      }}
    >
      {mutation.isError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{t('signOut.error')}</AlertDescription>
        </Alert>
      ) : null}
    </ConfirmDialog>
  )
}
