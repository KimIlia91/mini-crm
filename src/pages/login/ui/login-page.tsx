/*
 * Adapted from shadcn-admin (https://github.com/satnaing/shadcn-admin),
 * Copyright (c) 2024 Sat Naing, MIT License. See THIRD_PARTY_NOTICES.md.
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation } from 'react-router'

import { getAuthErrorCode, signInWithPassword } from '@/shared/api'
import { useSession } from '@/shared/auth'
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

import { LOGIN_FORM_ERROR_KEYS, loginSchema, type LoginValues } from '../model/login-schema'
import { getRedirectTarget } from '../model/redirect-target'

export function LoginPage() {
  const { t } = useTranslation('login')
  useDocumentTitle(t('title'))
  const session = useSession()
  const location = useLocation()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) })
  const mutation = useMutation({
    mutationFn: (values: LoginValues) => signInWithPassword(values.email, values.password),
  })

  if (session.status === 'signed-in') {
    return <Navigate to={getRedirectTarget(location.state)} replace />
  }

  const fieldError = (message: string | undefined) => {
    const key = pickKey(LOGIN_FORM_ERROR_KEYS, message)
    return key ? t(key) : undefined
  }
  const serverError = mutation.isError
    ? getAuthErrorCode(mutation.error) === 'invalid_credentials'
      ? t('errors.invalidCredentials')
      : t('errors.generic')
    : null

  return (
    <AuthLayout>
      <Card className="w-full">
        <CardHeader>
          <h1 className="font-heading text-xl leading-snug font-semibold">{t('title')}</h1>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            noValidate
            onSubmit={(event) => {
              void handleSubmit((values) => {
                mutation.mutate(values)
              })(event)
            }}
          >
            <FieldGroup className="gap-4">
              {serverError ? (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{serverError}</AlertDescription>
                </Alert>
              ) : null}
              <Field data-invalid={errors.email ? true : undefined} className="gap-1.5">
                <FieldLabel htmlFor="login-email">{t('email')}</FieldLabel>
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  aria-invalid={errors.email ? true : undefined}
                  aria-describedby={errors.email ? 'login-email-error' : undefined}
                  {...register('email')}
                />
                <FieldError id="login-email-error">{fieldError(errors.email?.message)}</FieldError>
              </Field>
              <Field data-invalid={errors.password ? true : undefined} className="gap-1.5">
                <FieldLabel htmlFor="login-password">{t('password')}</FieldLabel>
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  aria-invalid={errors.password ? true : undefined}
                  aria-describedby={errors.password ? 'login-password-error' : undefined}
                  {...register('password')}
                />
                <FieldError id="login-password-error">
                  {fieldError(errors.password?.message)}
                </FieldError>
              </Field>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? <Spinner data-icon="inline-start" /> : null}
                {t('submit')}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </AuthLayout>
  )
}
