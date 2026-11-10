import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import type { BoardTaskRow, TransitionRule } from '@/entities/task'

import { expectNoAxeViolations } from '../../../../tests/setup/axe'
import { TaskCard } from './task-card'

const TASK: BoardTaskRow = {
  id: 't1',
  title: 'Проверить проводку',
  status: 'in_review',
  created_at: '2026-11-02T10:00:00Z',
  assignee_id: 'e1',
  object: { id: 'o1', name: 'Склад №1' },
  assignee: { id: 'e1', full_name: 'Иван Исполнителев' },
}

const ACCEPT: TransitionRule = {
  from_status: 'in_review',
  to_status: 'accepted',
  actor_role: 'manager',
  comment_required: false,
}
const REWORK: TransitionRule = {
  from_status: 'in_review',
  to_status: 'rework',
  actor_role: 'manager',
  comment_required: true,
}

type Props = Partial<ComponentProps<typeof TaskCard>>

function renderCard(props: Props = {}) {
  const handlers = { onMove: vi.fn(), onDragStart: vi.fn(), onDragEnd: vi.fn() }
  const view = render(
    <MemoryRouter>
      <TaskCard
        task={TASK}
        showObject
        showAssignee
        transitions={[ACCEPT, REWORK]}
        movesDisabled={false}
        isPending={false}
        draggable={false}
        {...handlers}
        {...props}
      />
    </MemoryRouter>,
  )
  return { ...view, ...handlers }
}

describe('TaskCard', () => {
  it('shows the title as a link to the task with the full text in title', () => {
    renderCard()
    const link = screen.getByRole('link', { name: 'Проверить проводку' })
    expect(link).toHaveAttribute('href', '/tasks/t1')
    expect(link).toHaveAttribute('title', 'Проверить проводку')
    expect(link).toHaveAttribute('draggable', 'false')
  })

  it('shows buttons only for the given transitions', () => {
    renderCard()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Принять',
      'Вернуть на доработку',
    ])
  })

  it('shows no buttons and is not draggable without transitions', () => {
    renderCard({ transitions: [], draggable: true })
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByRole('article')).toHaveAttribute('draggable', 'false')
  })

  it('reports the target status of the clicked button', async () => {
    const { onMove } = renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Вернуть на доработку' }))
    expect(onMove).toHaveBeenCalledExactlyOnceWith('rework')
  })

  it('is draggable only when dragging is allowed', () => {
    const { unmount } = renderCard({ draggable: true })
    expect(screen.getByRole('article')).toHaveAttribute('draggable', 'true')
    unmount()
    renderCard({ draggable: false })
    expect(screen.getByRole('article')).toHaveAttribute('draggable', 'false')
  })

  it('disables every button while moves are disabled', () => {
    renderCard({ movesDisabled: true })
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
  })

  it('marks the card busy while pending and marks only the pressed button', () => {
    renderCard({ isPending: true, pendingTo: 'accepted' })
    expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Принять' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Вернуть на доработку' })).toHaveAttribute(
      'aria-busy',
      'false',
    )
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
  })

  it('is not busy when idle', () => {
    renderCard()
    expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'false')
  })

  it('shows the object and the assignee only when asked', () => {
    const { unmount } = renderCard()
    expect(screen.getByText('Склад №1')).toBeInTheDocument()
    expect(screen.getByText('Иван Исполнителев')).toBeInTheDocument()
    unmount()
    renderCard({ showObject: false, showAssignee: false })
    expect(screen.queryByText('Склад №1')).not.toBeInTheDocument()
    expect(screen.queryByText('Иван Исполнителев')).not.toBeInTheDocument()
  })

  it('has no axe violations', async () => {
    const { container } = renderCard()
    await expectNoAxeViolations(container)
  })
})
