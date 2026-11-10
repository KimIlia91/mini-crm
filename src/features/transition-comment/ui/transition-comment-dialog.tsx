import { zodResolver } from '@hookform/resolvers/zod'
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
  Label,
  Textarea,
} from '@/shared/ui'

import {
  COMMENT_FORM_ERROR_KEYS,
  commentSchema,
  type CommentValues,
} from '../model/transition-comment-schema'

interface TransitionCommentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  isPending: boolean
  error: unknown
  onSubmit: (comment: string) => void
  onCloseAutoFocus?: (event: Event) => void
}

function CommentForm({
  label,
  isPending,
  error,
  onSubmit,
}: Pick<TransitionCommentDialogProps, 'label' | 'isPending' | 'error' | 'onSubmit'>) {
  const { t } = useTranslation('transition-comment')
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
        void handleSubmit((values) => {
          onSubmit(values.comment)
        })(event)
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

/**
 * A transition that requires a comment (e.g. returning a task for rework). Controlled and without
 * a trigger: the caller opens it and closes it once the transition succeeds, so the input and the
 * server error stay in the form when the request fails.
 */
export function TransitionCommentDialog({
  open,
  onOpenChange,
  label,
  isPending,
  error,
  onSubmit,
  onCloseAutoFocus,
}: TransitionCommentDialogProps) {
  const { t } = useTranslation('transition-comment')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>{t('comment.description')}</DialogDescription>
        </DialogHeader>
        <CommentForm label={label} isPending={isPending} error={error} onSubmit={onSubmit} />
      </DialogContent>
    </Dialog>
  )
}
