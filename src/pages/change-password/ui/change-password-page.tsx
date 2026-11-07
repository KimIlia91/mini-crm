/*
 * Adapted from shadcn-admin (https://github.com/satnaing/shadcn-admin),
 * Copyright (c) 2024 Sat Naing, MIT License. See THIRD_PARTY_NOTICES.md.
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { profileKeys } from '@/entities/profile'
import { getAuthErrorCode, updatePassword } from '@/shared/api'
import { SignOutButton } from '@/shared/auth'
import { pickKey, useDocumentTitle } from '@/shared/lib'
import {
  Alert,
  AlertDescription,
  AuthLayout,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  Spinner,
} from '@/shared/ui'

import {
  changePasswordErrorKey,
  changePasswordSchema,
  PASSWORD_FORM_ERROR_KEYS,
  type ChangePasswordValues,
} from '../model/change-password-schema'

export function ChangePasswordPage() {
  const { t } = useTranslation('change-password')
  useDocumentTitle(t('title'))
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ChangePasswordValues>({ resolver: zodResolver(changePasswordSchema) })
  const mutation = useMutation({
    mutationFn: (values: ChangePasswordValues) => updatePassword(values.newPassword),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: profileKeys.all })
      await navigate('/', { replace: true })
    },
  })

  const fieldError = (message: string | undefined) => {
    const key = pickKey(PASSWORD_FORM_ERROR_KEYS, message)
    return key ? t(key) : undefined
  }

  return (
    <AuthLayout>
      <Card className="w-full">
        <CardHeader>
          <h1 className="font-heading text-xl leading-snug font-semibold">{t('title')}</h1>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            noValidate
            onSubmit={(event) => {
              void handleSubmit((values) => {
                mutation.mutate(values)
              })(event)
            }}
          >
            <FieldGroup className="gap-4">
              {mutation.isError ? (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>
                    {t(changePasswordErrorKey(getAuthErrorCode(mutation.error)))}
                  </AlertDescription>
                </Alert>
              ) : null}
              <Field data-invalid={errors.newPassword ? true : undefined} className="gap-1.5">
                <FieldLabel htmlFor="new-password">{t('newPassword')}</FieldLabel>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  aria-invalid={errors.newPassword ? true : undefined}
                  aria-describedby={errors.newPassword ? 'new-password-error' : undefined}
                  {...register('newPassword')}
                />
                <FieldError id="new-password-error">
                  {fieldError(errors.newPassword?.message)}
                </FieldError>
              </Field>
              <Field data-invalid={errors.confirmPassword ? true : undefined} className="gap-1.5">
                <FieldLabel htmlFor="confirm-password">{t('confirmPassword')}</FieldLabel>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  aria-invalid={errors.confirmPassword ? true : undefined}
                  aria-describedby={errors.confirmPassword ? 'confirm-password-error' : undefined}
                  {...register('confirmPassword')}
                />
                <FieldError id="confirm-password-error">
                  {fieldError(errors.confirmPassword?.message)}
                </FieldError>
              </Field>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? <Spinner data-icon="inline-start" /> : null}
                {t('submit')}
              </Button>
            </FieldGroup>
          </form>
          <SignOutButton />
        </CardContent>
      </Card>
    </AuthLayout>
  )
}
