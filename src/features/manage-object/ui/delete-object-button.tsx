import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ObjectRow } from '@/entities/object'
import { Alert, AlertDescription, Button, ConfirmDialog } from '@/shared/ui'

import { useDeleteObject } from '../api/object-mutations'
import { objectErrorKey } from '../model/object-error'

interface DeleteObjectButtonProps {
  object: ObjectRow
  onDeleted?: () => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
}

export function DeleteObjectButton({
  object,
  onDeleted,
  open: openProp,
  onOpenChange,
  onCloseAutoFocus,
}: DeleteObjectButtonProps) {
  const { t } = useTranslation('manage-object')
  const [innerOpen, setInnerOpen] = useState(false)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : innerOpen
  const mutation = useDeleteObject()

  function setOpen(next: boolean) {
    if (!next) mutation.reset()
    if (!isControlled) setInnerOpen(next)
    onOpenChange?.(next)
  }

  return (
    <>
      {isControlled ? null : (
        <Button
          variant="destructive"
          size="sm"
          aria-label={t('delete.triggerLabel', { name: object.name })}
          onClick={() => {
            setOpen(true)
          }}
        >
          {t('delete.trigger')}
        </Button>
      )}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        onCloseAutoFocus={onCloseAutoFocus}
        title={t('delete.title')}
        description={t('delete.description', { name: object.name })}
        confirmText={t('delete.confirm')}
        destructive
        isPending={mutation.isPending}
        onConfirm={() => {
          mutation.mutate(object.id, {
            onSuccess: () => {
              setOpen(false)
              onDeleted?.()
            },
          })
        }}
      >
        {mutation.isError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{t(objectErrorKey(mutation.error))}</AlertDescription>
          </Alert>
        ) : null}
      </ConfirmDialog>
    </>
  )
}
