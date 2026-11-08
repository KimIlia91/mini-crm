import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'

import { THEME_STORAGE_KEY, ThemeProvider } from '@/shared/theme'
import { DropdownMenu } from '@/shared/ui'

import { UserMenuContent } from './user-menu'

// On phones the header has no theme button: the profile menu is the only place to change it.
describe('UserMenuContent', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('switches the theme from the profile menu by keyboard', async () => {
    const user = userEvent.setup()
    render(
      <ThemeProvider>
        <MemoryRouter>
          <DropdownMenu open>
            <UserMenuContent
              viewer={{ fullName: 'Иван Петров', role: 'manager' }}
              onSignOut={() => undefined}
            />
          </DropdownMenu>
        </MemoryRouter>
      </ThemeProvider>,
    )

    const dark = screen.getByRole('menuitemradio', { name: 'Тёмная' })
    expect(dark).toHaveAttribute('aria-checked', 'false')
    dark.focus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('menuitemradio', { name: 'Тёмная' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })
})
