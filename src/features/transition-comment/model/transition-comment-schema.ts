import { z } from 'zod'

/** Zod messages are `transition-comment` translation keys; the dialog translates them. */
export const COMMENT_FORM_ERRORS = {
  required: 'validation.commentRequired',
  tooLong: 'validation.commentTooLong',
} as const

export const COMMENT_FORM_ERROR_KEYS = Object.values(COMMENT_FORM_ERRORS)

export const commentSchema = z.object({
  comment: z
    .string()
    .trim()
    .min(1, COMMENT_FORM_ERRORS.required)
    .max(1000, COMMENT_FORM_ERRORS.tooLong),
})

export type CommentValues = z.infer<typeof commentSchema>
