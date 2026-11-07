/*
 * Adapted from shadcn-admin (https://github.com/satnaing/shadcn-admin),
 * Copyright (c) 2024 Sat Naing, MIT License. See THIRD_PARTY_NOTICES.md.
 */
import { useTranslation } from 'react-i18next'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './alert-dialog'
import { Button } from './button'
import { Spinner } from './spinner'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Where focus goes after closing, for dialogs opened without a `Trigger`. */
  onCloseAutoFocus?: (event: Event) => void
  title: string
  description: React.ReactNode
  confirmText: string
  cancelText?: string
  destructive?: boolean
  isPending?: boolean
  /**
   * Called on confirm. The dialog does NOT close by itself, so the caller can keep it open until
   * the server answers and show an error in `children`.
   */
  onConfirm: () => void
  /** Extra content between the description and the buttons (e.g. an error `Alert`). */
  children?: React.ReactNode
}

/** Confirmation of a risky action: focus starts on "Cancel", Esc cancels, a pending request blocks both buttons. */
export function ConfirmDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
  title,
  description,
  confirmText,
  cancelText,
  destructive = false,
  isPending = false,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const { t } = useTranslation('common')
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription className="[overflow-wrap:anywhere]">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>
            {cancelText ?? t('actions.cancel')}
          </AlertDialogCancel>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            disabled={isPending}
            onClick={onConfirm}
          >
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            {confirmText}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
