import { useRef } from 'react'
import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react'

import { Button } from './button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu'

interface ActionsMenuProps {
  /** Accessible name of the «…» button. */
  label: string
  /** An item is shown only when its handler is given; with none, nothing is rendered. */
  onEdit?: (opener: HTMLElement | null) => void
  onDelete?: (opener: HTMLElement | null) => void
  editLabel: string
  deleteLabel: string
  /** `outline` in page headers, `ghost` in table rows. */
  appearance?: 'outline' | 'ghost'
}

/**
 * The «…» menu with «Edit» and «Delete» used for a table row, an object and a task alike. Handlers
 * receive the «…» button so the caller can return focus to it when the dialog they open closes.
 */
export function ActionsMenu({
  label,
  onEdit,
  onDelete,
  editLabel,
  deleteLabel,
  appearance = 'outline',
}: ActionsMenuProps) {
  const opener = useRef<HTMLButtonElement>(null)
  if (!onEdit && !onDelete) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={opener}
          variant={appearance}
          size={appearance === 'ghost' ? 'icon-sm' : 'icon'}
          className="shrink-0 data-[state=open]:bg-muted"
          aria-label={label}
        >
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onEdit ? (
          <DropdownMenuItem
            onSelect={() => {
              onEdit(opener.current)
            }}
          >
            <PencilIcon />
            {editLabel}
          </DropdownMenuItem>
        ) : null}
        {onEdit && onDelete ? <DropdownMenuSeparator /> : null}
        {onDelete ? (
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              onDelete(opener.current)
            }}
          >
            <Trash2Icon />
            {deleteLabel}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
