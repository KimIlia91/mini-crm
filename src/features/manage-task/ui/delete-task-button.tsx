import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { useTaskErrorMessage } from '@/entities/task'
import { Alert, AlertDescription, Button, ConfirmDialog } from '@/shared/ui'

import { useDeleteTask } from '../api/task-mutations'

interface DeleteTaskButtonProps {
  taskId: string
  objectId: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
}

export function DeleteTaskButton({
  taskId,
  objectId,
  open: openProp,
  onOpenChange,
  onCloseAutoFocus,
}: DeleteTaskButtonProps) {
  const { t } = useTranslation('manage-task')
  const taskErrorMessage = useTaskErrorMessage()
  const [innerOpen, setInnerOpen] = useState(false)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : innerOpen
  function setOpen(next: boolean) {
    if (next) mutation.reset()
    if (!isControlled) setInnerOpen(next)
    onOpenChange?.(next)
  }
  const navigate = useNavigate()
  const mutation = useDeleteTask()

  return (
    <>
      {isControlled ? null : (
        <Button
          variant="destructive"
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
        description={t('delete.description')}
        confirmText={t('delete.confirm')}
        destructive
        isPending={mutation.isPending}
        onConfirm={() => {
          mutation.mutate(taskId, {
            onSuccess: () => {
              void navigate(`/objects/${objectId}`)
            },
          })
        }}
      >
        {mutation.isError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{taskErrorMessage(mutation.error)}</AlertDescription>
          </Alert>
        ) : null}
      </ConfirmDialog>
    </>
  )
}
