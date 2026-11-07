import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PlusIcon } from 'lucide-react'

import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/shared/ui'

import { useCreateTask, useUpdateTask } from '../api/task-mutations'
import type { TaskFormValues } from '../model/task-form-schema'
import { TaskForm } from './task-form'

/** Controlled mode (e.g. opened from an actions menu): no built-in trigger button. */
interface ControlledProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
}

export type TaskFormDialogProps =
  | { mode: 'create'; objectId: string }
  | ({
      mode: 'edit'
      task: { id: string; title: string; description: string; assigneeId: string }
    } & ControlledProps)

/** Create a task on an object, or edit title/description/assignee. The object is never editable. */
export function TaskFormDialog(props: TaskFormDialogProps) {
  const { t } = useTranslation('manage-task')
  const [innerOpen, setInnerOpen] = useState(false)
  const controlled = props.mode === 'edit' && props.open !== undefined
  const open = props.mode === 'edit' && props.open !== undefined ? props.open : innerOpen
  function setOpen(next: boolean) {
    if (!controlled) setInnerOpen(next)
    if (props.mode === 'edit') props.onOpenChange?.(next)
  }
  const create = useCreateTask()
  const update = useUpdateTask()
  const mutation = props.mode === 'create' ? create : update

  const isCreate = props.mode === 'create'
  const title = isCreate ? t('form.createTitle') : t('form.editTitle')
  const defaultValues: TaskFormValues = isCreate
    ? { title: '', description: '', assigneeId: '' }
    : {
        title: props.task.title,
        description: props.task.description,
        assigneeId: props.task.assigneeId,
      }

  function handleSubmit(values: TaskFormValues) {
    const options = {
      onSuccess: () => {
        setOpen(false)
      },
    }
    if (props.mode === 'create') {
      create.mutate({ objectId: props.objectId, ...values }, options)
    } else {
      update.mutate({ id: props.task.id, ...values }, options)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) mutation.reset()
        setOpen(next)
      }}
    >
      {controlled ? null : (
        <SheetTrigger asChild>
          <Button variant={isCreate ? 'default' : 'outline'}>
            {isCreate ? <PlusIcon data-icon="inline-start" /> : null}
            {isCreate ? t('form.createTrigger') : t('form.editTrigger')}
          </Button>
        </SheetTrigger>
      )}
      <SheetContent onCloseAutoFocus={props.mode === 'edit' ? props.onCloseAutoFocus : undefined}>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {isCreate ? t('form.createDescription') : t('form.editDescription')}
          </SheetDescription>
        </SheetHeader>
        <TaskForm
          defaultValues={defaultValues}
          submitLabel={isCreate ? t('form.create') : t('form.save')}
          isPending={mutation.isPending}
          error={mutation.error}
          onSubmit={handleSubmit}
        />
      </SheetContent>
    </Sheet>
  )
}
