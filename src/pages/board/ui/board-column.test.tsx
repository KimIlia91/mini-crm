import { fireEvent, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAxeViolations } from '../../../../tests/setup/axe'
import { BoardColumn } from './board-column'

type Props = Partial<ComponentProps<typeof BoardColumn>>

function column(props: Props = {}, handlers = {}) {
  return (
    <BoardColumn
      status="in_review"
      total={2}
      state="ready"
      onRetry={() => undefined}
      dropState="idle"
      onDropTask={() => undefined}
      canShowMore={false}
      remaining={0}
      isLoadingMore={false}
      onShowMore={() => undefined}
      {...handlers}
      {...props}
    >
      <p>карточка</p>
    </BoardColumn>
  )
}

describe('BoardColumn', () => {
  it('shows a titled section with the total and the children', async () => {
    const { container } = render(column())
    expect(screen.getByRole('region', { name: /На проверке/ })).toHaveTextContent('2')
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('На проверке')
    expect(screen.getByText('карточка')).toBeInTheDocument()
    await expectNoAxeViolations(container)
  })

  it('shows the empty text instead of children when the total is 0', () => {
    render(column({ total: 0 }))
    expect(screen.getByText('Нет задач')).toBeInTheDocument()
    expect(screen.queryByText('карточка')).not.toBeInTheDocument()
  })

  it('shows a loading status without children', () => {
    render(column({ state: 'loading', total: undefined }))
    expect(screen.getByRole('status', { name: 'Загружаем задачи' })).toBeInTheDocument()
    expect(screen.queryByText('карточка')).not.toBeInTheDocument()
  })

  it('shows an error with retry', async () => {
    const onRetry = vi.fn()
    render(column({ state: 'error', total: undefined }, { onRetry }))
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить колонку')
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('shows the move hint, the comment hint, and no hint for a blocked column', () => {
    const { rerender } = render(column({ dropState: 'allowed', dropHint: 'move' }))
    expect(screen.getByText('Переместить сюда')).toBeInTheDocument()
    rerender(column({ status: 'rework', dropState: 'allowed', dropHint: 'comment' }))
    expect(screen.getByText('Нужен комментарий')).toBeInTheDocument()
    rerender(column({ status: 'rework', dropState: 'blocked', dropHint: 'move' }))
    expect(screen.queryByText('Нужен комментарий')).not.toBeInTheDocument()
    expect(screen.queryByText('Переместить сюда')).not.toBeInTheDocument()
  })

  it('accepts a drag over and a drop only when allowed', () => {
    const onDropTask = vi.fn()
    const { rerender } = render(column({ dropState: 'allowed', dropHint: 'move' }, { onDropTask }))
    const allowed = screen.getByRole('region')
    expect(fireEvent.dragOver(allowed, { dataTransfer: { dropEffect: 'none' } })).toBe(false)
    fireEvent.drop(allowed, { dataTransfer: {} })
    expect(onDropTask).toHaveBeenCalledOnce()

    onDropTask.mockClear()
    rerender(column({ dropState: 'blocked' }, { onDropTask }))
    const blocked = screen.getByRole('region')
    expect(fireEvent.dragOver(blocked, { dataTransfer: { dropEffect: 'none' } })).toBe(true)
    fireEvent.drop(blocked, { dataTransfer: {} })

    rerender(column({ dropState: 'idle' }, { onDropTask }))
    const idle = screen.getByRole('region')
    expect(fireEvent.dragOver(idle, { dataTransfer: { dropEffect: 'none' } })).toBe(true)
    fireEvent.drop(idle, { dataTransfer: {} })
    expect(onDropTask).not.toHaveBeenCalled()
  })

  it('shows «Показать ещё» with the remaining count and asks for more', async () => {
    const onShowMore = vi.fn()
    render(column({ total: 25, canShowMore: true, remaining: 5 }, { onShowMore }))
    await userEvent.click(screen.getByRole('button', { name: 'Показать ещё (5)' }))
    expect(onShowMore).toHaveBeenCalledOnce()
  })

  it('disables «Показать ещё» while loading more', () => {
    render(column({ total: 25, canShowMore: true, remaining: 5, isLoadingMore: true }))
    expect(screen.getByRole('button', { name: 'Показать ещё (5)' })).toBeDisabled()
  })

  it('shows the cap message instead of the button at the ceiling', () => {
    render(column({ total: 150, capped: { shown: 100, total: 150 } }))
    expect(screen.getByText('Показаны 100 из 150')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Показать ещё/ })).not.toBeInTheDocument()
  })

  it('renders only the body in the bare mode: no section and no heading', () => {
    render(column({ bare: true }))
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.getByText('карточка')).toBeInTheDocument()
  })
})
