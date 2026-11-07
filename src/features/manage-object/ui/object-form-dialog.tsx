import { zodResolver } from '@hookform/resolvers/zod'
import { useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import type { ObjectRow } from '@/entities/object'
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  Spinner,
} from '@/shared/ui'
import { pickKey } from '@/shared/lib'

import { useCreateObject, useUpdateObject } from '../api/object-mutations'
import { objectErrorKey } from '../model/object-error'
import {
  OBJECT_FORM_ERROR_KEYS,
  objectFormSchema,
  type ObjectFormValues,
} from '../model/object-form-schema'

interface ObjectFormDialogProps {
  object?: ObjectRow
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
}

export function ObjectFormDialog({
  object,
  trigger,
  open: openProp,
  onOpenChange,
  onCloseAutoFocus,
}: ObjectFormDialogProps) {
  const { t } = useTranslation('manage-object')
  const [innerOpen, setInnerOpen] = useState(false)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : innerOpen
  const title = object ? t('form.editTitle') : t('form.createTitle')

  function setOpen(next: boolean) {
    if (!isControlled) setInnerOpen(next)
    onOpenChange?.(next)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t('form.description')}</DialogDescription>
        </DialogHeader>
        <ObjectForm
          object={object}
          onDone={() => {
            setOpen(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function ObjectForm({ object, onDone }: { object?: ObjectRow; onDone: () => void }) {
  const { t } = useTranslation('manage-object')
  const create = useCreateObject()
  const update = useUpdateObject(object?.id ?? '')
  const mutation = object ? update : create
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ObjectFormValues>({
    resolver: zodResolver(objectFormSchema),
    defaultValues: { name: object?.name ?? '', address: object?.address ?? '' },
  })

  function fieldError(message: string | undefined) {
    const key = pickKey(OBJECT_FORM_ERROR_KEYS, message)
    return key ? t(key) : undefined
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void handleSubmit((values) => {
          mutation.mutate(values, { onSuccess: onDone })
        })(event)
      }}
    >
      <FieldGroup className="gap-4">
        {mutation.isError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{t(objectErrorKey(mutation.error))}</AlertDescription>
          </Alert>
        ) : null}
        <Field data-invalid={errors.name ? true : undefined} className="gap-1.5">
          <FieldLabel htmlFor="object-name">{t('form.name')}</FieldLabel>
          <Input
            id="object-name"
            autoComplete="off"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? 'object-name-error' : undefined}
            {...register('name')}
          />
          <FieldError id="object-name-error">{fieldError(errors.name?.message)}</FieldError>
        </Field>
        <Field data-invalid={errors.address ? true : undefined} className="gap-1.5">
          <FieldLabel htmlFor="object-address">{t('form.address')}</FieldLabel>
          <Input
            id="object-address"
            autoComplete="off"
            aria-invalid={errors.address ? true : undefined}
            aria-describedby={errors.address ? 'object-address-error' : undefined}
            {...register('address')}
          />
          <FieldError id="object-address-error">{fieldError(errors.address?.message)}</FieldError>
        </Field>
        <DialogFooter>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? <Spinner data-icon="inline-start" /> : null}
            {object ? t('form.save') : t('form.create')}
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  )
}
