import { z } from 'zod'

/** Zod messages are `manage-object` translation keys; the form translates them. */
export const OBJECT_FORM_ERRORS = {
  nameRequired: 'validation.nameRequired',
  nameTooLong: 'validation.nameTooLong',
  addressRequired: 'validation.addressRequired',
  addressTooLong: 'validation.addressTooLong',
} as const

export const OBJECT_FORM_ERROR_KEYS = Object.values(OBJECT_FORM_ERRORS)

export const objectFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, OBJECT_FORM_ERRORS.nameRequired)
    .max(200, OBJECT_FORM_ERRORS.nameTooLong),
  address: z
    .string()
    .trim()
    .min(1, OBJECT_FORM_ERRORS.addressRequired)
    .max(500, OBJECT_FORM_ERRORS.addressTooLong),
})

export type ObjectFormValues = z.infer<typeof objectFormSchema>
