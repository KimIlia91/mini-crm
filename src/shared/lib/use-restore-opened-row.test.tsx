import { render as baseRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useNavigate } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { rememberOpenedRow, takeOpenedRow } from './list-state'
import { openedRowLink, useRestoreOpenedRow } from './use-restore-opened-row'

function render(ui: React.ReactNode) {
  return baseRender(ui, { wrapper: MemoryRouter })
}

afterEach(() => {
  window.sessionStorage.clear()
})

function List({ ready = true, rows = ['a', 'b'] }: { ready?: boolean; rows?: string[] }) {
  useRestoreOpenedRow('objects', ready)
  return (
    <ul>
      {rows.map((id) => (
        <li key={id}>
          <a href={`#${id}`} {...openedRowLink('objects', id)}>
            {`Row ${id}`}
          </a>
        </li>
      ))}
    </ul>
  )
}

describe('useRestoreOpenedRow', () => {
  it('remembers the clicked row and focuses its link on the way back', async () => {
    const user = userEvent.setup()
    const view = render(<List />)
    await user.click(screen.getByRole('link', { name: 'Row b' }))
    view.unmount()

    render(<List />)
    expect(screen.getByRole('link', { name: 'Row b' })).toHaveFocus()
  })

  it('restores once: the opened row is forgotten after use', () => {
    rememberOpenedRow('objects', 'a')
    render(<List />)
    expect(screen.getByRole('link', { name: 'Row a' })).toHaveFocus()
    expect(takeOpenedRow('objects')).toBeNull()
  })

  it('waits for the data and keeps the remembered row until ready', () => {
    rememberOpenedRow('objects', 'a')
    const { rerender } = render(<List ready={false} />)
    expect(screen.getByRole('link', { name: 'Row a' })).not.toHaveFocus()
    rerender(<List ready />)
    expect(screen.getByRole('link', { name: 'Row a' })).toHaveFocus()
  })

  it('focuses the row that appears after the data is ready (table still fading in)', async () => {
    rememberOpenedRow('objects', 'a')
    const { rerender } = render(<List rows={[]} />)
    expect(document.body).toHaveFocus()
    rerender(<List rows={['a', 'b']} />)
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Row a' })).toHaveFocus()
    })
    expect(takeOpenedRow('objects')).toBeNull()
  })

  it('does nothing when the row is not on the page, and forgets it after a while', () => {
    vi.useFakeTimers()
    try {
      rememberOpenedRow('objects', 'gone')
      render(<List />)
      expect(document.body).toHaveFocus()
      vi.advanceTimersByTime(3_001)
      expect(takeOpenedRow('objects')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not move focus when nothing was opened', () => {
    render(<List />)
    expect(document.body).toHaveFocus()
  })
})

describe('useRestoreOpenedRow on a list that stays mounted', () => {
  function Visit() {
    const navigate = useNavigate()
    return (
      <>
        <button
          type="button"
          onClick={() => {
            rememberOpenedRow('objects', 'b')
            void navigate('/objects?page=3')
          }}
        >
          Come back
        </button>
        <List />
      </>
    )
  }

  it('focuses the opened row on a new visit even though the list was never unmounted', async () => {
    const user = userEvent.setup()
    render(<Visit />)
    await user.click(screen.getByRole('button', { name: 'Come back' }))
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Row b' })).toHaveFocus()
    })
  })
})
