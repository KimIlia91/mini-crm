import { z } from 'zod'

import type { changePasswordRu } from '../i18n/ru'

/** Zod messages are `change-password` translation keys; the form translates them. */
export const PASSWORD_FORM_ERRORS = {
  minLength: 'validation.minLength',
  lowercase: 'validation.lowercase',
  uppercase: 'validation.uppercase',
  digit: 'validation.digit',
  confirmRequired: 'validation.confirmRequired',
  mismatch: 'validation.mismatch',
} as const

export const PASSWORD_FORM_ERROR_KEYS = Object.values(PASSWORD_FORM_ERRORS)

export const changePasswordSchema = z
  .object({
    newPassword: z
      .string()
      .min(8, PASSWORD_FORM_ERRORS.minLength)
      .regex(/[a-z]/, PASSWORD_FORM_ERRORS.lowercase)
      .regex(/[A-Z]/, PASSWORD_FORM_ERRORS.uppercase)
      .regex(/\d/, PASSWORD_FORM_ERRORS.digit),
    confirmPassword: z.string().min(1, PASSWORD_FORM_ERRORS.confirmRequired),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: PASSWORD_FORM_ERRORS.mismatch,
    path: ['confirmPassword'],
  })

export type ChangePasswordValues = z.infer<typeof changePasswordSchema>

export type ChangePasswordErrorKey = `errors.${keyof typeof changePasswordRu.errors}`

/** `change-password` translation key for an auth error code. */
export function changePasswordErrorKey(code: string | undefined): ChangePasswordErrorKey {
  switch (code) {
    case 'same_password':
      return 'errors.samePassword'
    case 'weak_password':
      return 'errors.weakPassword'
    default:
      return 'errors.generic'
  }
}
