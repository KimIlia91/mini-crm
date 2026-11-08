import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { profileQueries } from '@/entities/profile'
import { useTaskErrorMessage } from '@/entities/task'
import { pickKey } from '@/shared/lib'
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SheetFooter,
  Skeleton,
  Spinner,
  Textarea,
} from '@/shared/ui'

import {
  TASK_FORM_ERROR_KEYS,
  taskFormSchema,
  type TaskFormValues,
} from '../model/task-form-schema'

interface TaskFormProps {
  defaultValues: TaskFormValues
  submitLabel: string
  isPending: boolean
  error: unknown
  onSubmit: (values: TaskFormValues) => void
}

/** Mounted only while the sheet is open, so every opening starts from fresh defaults. */
export function TaskForm({
  defaultValues,
  submitLabel,
  isPending,
  error,
  onSubmit,
}: TaskFormProps) {
  const { t } = useTranslation('manage-task')
  const taskErrorMessage = useTaskErrorMessage()
  const executors = useQuery(profileQueries.executors())
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<TaskFormValues>({ resolver: zodResolver(taskFormSchema), defaultValues })

  function fieldError(message: string | undefined) {
    const key = pickKey(TASK_FORM_ERROR_KEYS, message)
    return key ? t(key) : undefined
  }

  // Cached executors stay usable when a background refetch fails; the error shows only without data.
  const executorList = executors.data
  const noExecutors = executorList?.length === 0

  return (
    <form
      noValidate
      className="flex flex-col"
      onSubmit={(event) => {
        void handleSubmit(onSubmit)(event)
      }}
    >
      <FieldGroup className="gap-4 px-4">
        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{taskErrorMessage(error)}</AlertDescription>
          </Alert>
        ) : null}
        <Field data-invalid={errors.title ? true : undefined} className="gap-1.5">
          <FieldLabel htmlFor="task-title">{t('form.title')}</FieldLabel>
          <Input
            id="task-title"
            autoComplete="off"
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={errors.title ? 'task-title-error' : undefined}
            {...register('title')}
          />
          <FieldError id="task-title-error">{fieldError(errors.title?.message)}</FieldError>
        </Field>
        <Field data-invalid={errors.description ? true : undefined} className="gap-1.5">
          <FieldLabel htmlFor="task-description">{t('form.description')}</FieldLabel>
          <Textarea
            id="task-description"
            rows={4}
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={errors.description ? 'task-description-error' : undefined}
            {...register('description')}
          />
          <FieldError id="task-description-error">
            {fieldError(errors.description?.message)}
          </FieldError>
        </Field>
        <Field data-invalid={errors.assigneeId ? true : undefined} className="gap-1.5">
          <FieldLabel htmlFor="task-assignee">{t('form.assignee')}</FieldLabel>
          {executors.isPending ? <Skeleton className="h-9 w-full" /> : null}
          {executors.isError && executorList === undefined ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription className="flex items-center justify-between gap-2">
                {t('form.executorsError')}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void executors.refetch()
                  }}
                >
                  {t('form.retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {noExecutors ? (
            <p className="text-sm text-muted-foreground">{t('form.noExecutors')}</p>
          ) : null}
          {executorList && !noExecutors ? (
            <Controller
              control={control}
              name="assigneeId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id="task-assignee"
                    ref={field.ref}
                    onBlur={field.onBlur}
                    className="w-full min-w-0"
                    aria-invalid={errors.assigneeId ? true : undefined}
                    aria-describedby={errors.assigneeId ? 'task-assignee-error' : undefined}
                  >
                    <SelectValue
                      placeholder={t('form.assigneePlaceholder')}
                      title={executorList.find((item) => item.id === field.value)?.fullName}
                    />
                  </SelectTrigger>
                  <SelectContent
                    position="popper"
                    className="max-h-[min(18rem,var(--radix-select-content-available-height))]"
                  >
                    {executorList.map((executor) => (
                      <SelectItem
                        key={executor.id}
                        value={executor.id}
                        className="[overflow-wrap:anywhere]"
                      >
                        {executor.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          ) : null}
          <FieldError id="task-assignee-error">{fieldError(errors.assigneeId?.message)}</FieldError>
        </Field>
      </FieldGroup>
      <SheetFooter>
        <Button type="submit" disabled={isPending || executorList === undefined || noExecutors}>
          {isPending ? <Spinner data-icon="inline-start" /> : null}
          {submitLabel}
        </Button>
      </SheetFooter>
    </form>
  )
}
