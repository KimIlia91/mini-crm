import { z } from 'zod'

/** Zod messages are `manage-task` translation keys; the form translates them. */
export const TASK_FORM_ERRORS = {
  titleRequired: 'validation.titleRequired',
  titleTooLong: 'validation.titleTooLong',
  descriptionTooLong: 'validation.descriptionTooLong',
  assigneeRequired: 'validation.assigneeRequired',
} as const

export const TASK_FORM_ERROR_KEYS = Object.values(TASK_FORM_ERRORS)

export const taskFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, TASK_FORM_ERRORS.titleRequired)
    .max(200, TASK_FORM_ERRORS.titleTooLong),
  description: z.string().max(5000, TASK_FORM_ERRORS.descriptionTooLong),
  assigneeId: z.uuid(TASK_FORM_ERRORS.assigneeRequired),
})

export type TaskFormValues = z.infer<typeof taskFormSchema>
