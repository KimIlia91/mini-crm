interface FitChipsInput {
  /** Widths of the chips, in their order. */
  widths: readonly number[]
  /** Width left for the chips and «+N». */
  available: number
  gap: number
  /** Width of «+N», needed only when some chips are hidden. */
  moreWidth: number
}

/** How many leading chips fit in one line, leaving room for «+N» when the rest are hidden. */
export function fitChipCount({ widths, available, gap, moreWidth }: FitChipsInput): number {
  let used = 0
  for (const [index, width] of widths.entries()) {
    const next = used + (index > 0 ? gap : 0) + width
    const isLast = index === widths.length - 1
    if (next + (isLast ? 0 : gap + moreWidth) > available) return index
    used = next
  }
  return widths.length
}
