import { cn } from 'cn'

/** The full text goes to `title` only while it is actually cut off. */
export function TruncatedText({ text, className }: { text: string; className?: string }) {
  return (
    <span
      ref={(node) => {
        if (!node) return
        if (node.scrollWidth > node.clientWidth) node.title = text
        else node.removeAttribute('title')
      }}
      className={cn('min-w-0 truncate', className)}
    >
      {text}
    </span>
  )
}
