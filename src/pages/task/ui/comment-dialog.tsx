import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { useTaskErrorMessage } from '@/entities/task'
import { pickKey } from '@/shared/lib'
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
  Label,
  Textarea,
} from '@/shared/ui'

import { COMMENT_FORM_ERROR_KEYS, commentSchema, type CommentValues } from '../model/comment-schema'

interface CommentDialogProps {
  label: string
  disabled: boolean
  isPending: boolean
  error: unknown
  onOpen: () => void
  onSubmit: (comment: string, onDone: () => void) => void
}

function CommentForm({
  label,
  isPending,
  error,
  onSubmit,
}: Pick<CommentDialogProps, 'label' | 'isPending' | 'error'> & {
  onSubmit: (values: CommentValues) => void
}) {
  const { t } = useTranslation('task')
  const taskErrorMessage = useTaskErrorMessage()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CommentValues>({
    resolver: zodResolver(commentSchema),
    defaultValues: { comment: '' },
  })

  const commentErrorKey = pickKey(COMMENT_FORM_ERROR_KEYS, errors.comment?.message)

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        void handleSubmit(onSubmit)(event)
      }}
    >
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{taskErrorMessage(error)}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="transition-comment">{t('comment.label')}</Label>
        <Textarea
          id="transition-comment"
          rows={4}
          aria-invalid={errors.comment ? true : undefined}
          aria-describedby={errors.comment ? 'transition-comment-error' : undefined}
          {...register('comment')}
        />
        {commentErrorKey ? (
          <p id="transition-comment-error" className="text-sm text-destructive">
            {t(commentErrorKey)}
          </p>
        ) : null}
      </div>
      <DialogFooter>
        <Button type="submit" disabled={isPending}>
          {label}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** A transition that requires a comment (e.g. returning a task for rework). */
export function CommentDialog({
  label,
  disabled,
  isPending,
  error,
  onOpen,
  onSubmit,
}: CommentDialogProps) {
  const { t } = useTranslation('task')
  const [open, setOpen] = useState(false)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpen()
        setOpen(next)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>{t('comment.description')}</DialogDescription>
        </DialogHeader>
        <CommentForm
          label={label}
          isPending={isPending}
          error={error}
          onSubmit={(values) => {
            onSubmit(values.comment, () => {
              setOpen(false)
            })
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
