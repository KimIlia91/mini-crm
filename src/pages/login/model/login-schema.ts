import { z } from 'zod'

/** Zod messages are `login` translation keys; the form translates them. */
export const LOGIN_FORM_ERRORS = {
  emailInvalid: 'validation.emailInvalid',
  passwordRequired: 'validation.passwordRequired',
} as const

export const LOGIN_FORM_ERROR_KEYS = Object.values(LOGIN_FORM_ERRORS)

export const loginSchema = z.object({
  email: z.email(LOGIN_FORM_ERRORS.emailInvalid),
  password: z.string().min(1, LOGIN_FORM_ERRORS.passwordRequired),
})

export type LoginValues = z.infer<typeof loginSchema>
