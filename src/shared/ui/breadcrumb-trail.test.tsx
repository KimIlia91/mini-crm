import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LucideIcon } from 'lucide-react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { BreadcrumbTrail, BreadcrumbTrailHost } from './breadcrumb-trail'

const TestIcon = (() => <svg data-testid="row-icon" />) as unknown as LucideIcon

describe('BreadcrumbTrail mobile path menu', () => {
  it('lists the path with icons; the current page is the last row, not a link', async () => {
    render(
      <MemoryRouter>
        <BreadcrumbTrailHost>
          <BreadcrumbTrail
            items={[
              { id: 'objects', label: 'Объекты', to: '/objects', icon: TestIcon },
              { id: 'task:1', label: 'Моя задача', icon: TestIcon },
            ]}
          />
        </BreadcrumbTrailHost>
      </MemoryRouter>,
    )
    await userEvent.click(await screen.findByRole('button', { name: /показать путь/ }))
    const menu = await screen.findByRole('menu')
    const rows = within(menu).getAllByRole('menuitem')
    expect(rows).toHaveLength(2)
    const [first, current] = rows as [HTMLElement, HTMLElement]
    expect(first).toHaveAttribute('href', '/objects')
    expect(within(first).getByTestId('row-icon')).toBeInTheDocument()
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(current).not.toHaveAttribute('href')
    expect(within(current).getByTestId('row-icon')).toBeInTheDocument()
  })
})
