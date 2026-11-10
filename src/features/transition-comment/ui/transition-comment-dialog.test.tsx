import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAxeViolations } from '../../../../tests/setup/axe'
import { TransitionCommentDialog } from './transition-comment-dialog'

interface HarnessProps {
  onSubmit?: (comment: string) => void
  onOpenChange?: (open: boolean) => void
  error?: unknown
  isPending?: boolean
}

function Harness({
  onSubmit = () => undefined,
  onOpenChange,
  error,
  isPending = false,
}: HarnessProps) {
  const [open, setOpen] = useState(true)
  return (
    <TransitionCommentDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange?.(next)
        setOpen(next)
      }}
      label="Вернуть на доработку"
      isPending={isPending}
      error={error}
      onSubmit={onSubmit}
    />
  )
}

function submitButton() {
  return within(screen.getByRole('dialog')).getByRole('button', { name: 'Вернуть на доработку' })
}

describe('TransitionCommentDialog', () => {
  it('shows a labelled dialog with the comment field and no axe violations', async () => {
    render(<Harness />)
    const dialog = await screen.findByRole('dialog', { name: 'Вернуть на доработку' })
    expect(within(dialog).getByLabelText('Комментарий')).toBeInTheDocument()
    await expectNoAxeViolations(document.body)
  })

  it('renders nothing while closed', () => {
    render(
      <TransitionCommentDialog
        open={false}
        onOpenChange={() => undefined}
        label="x"
        isPending={false}
        error={null}
        onSubmit={() => undefined}
      />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the required error on an empty submit and does not call onSubmit', async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    await userEvent.click(submitButton())
    expect(await screen.findByText('Укажите комментарий')).toBeInTheDocument()
    expect(screen.getByLabelText('Комментарий')).toBeInvalid()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('treats whitespace as empty', async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    await userEvent.type(screen.getByLabelText('Комментарий'), '   ')
    await userEvent.click(submitButton())
    expect(await screen.findByText('Укажите комментарий')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rejects a comment longer than 1000 characters', async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    await userEvent.click(screen.getByLabelText('Комментарий'))
    await userEvent.paste('a'.repeat(1001))
    await userEvent.click(submitButton())
    expect(await screen.findByText('Не более 1000 символов')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits the trimmed comment once', async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    await userEvent.type(screen.getByLabelText('Комментарий'), '  Нет фото  ')
    await userEvent.click(submitButton())
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    expect(onSubmit).toHaveBeenCalledWith('Нет фото')
  })

  it('shows a server error inside the form and keeps the typed input', async () => {
    render(<Harness error={{ code: 'P0001', message: 'transition_not_allowed' }} />)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Действие недоступно: статус задачи изменился',
    )
    await userEvent.type(within(dialog).getByLabelText('Комментарий'), 'Нет фото')
    expect(within(dialog).getByLabelText('Комментарий')).toHaveValue('Нет фото')
  })

  it('keeps the input when the error appears after typing', async () => {
    const { rerender } = render(<Harness />)
    await userEvent.type(screen.getByLabelText('Комментарий'), 'Нет фото')
    rerender(<Harness error={{ code: 'P0001', message: 'comment_required' }} />)
    expect(screen.getByLabelText('Комментарий')).toHaveValue('Нет фото')
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('disables the submit button while pending', async () => {
    render(<Harness isPending />)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(submitButton()).toBeDisabled()
  })

  it('Esc asks to close without submitting', async () => {
    const onSubmit = vi.fn()
    const onOpenChange = vi.fn()
    render(<Harness onSubmit={onSubmit} onOpenChange={onOpenChange} />)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
