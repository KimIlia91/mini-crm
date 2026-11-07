/** Up to two capital letters from the first two words of a name («Иван Петров» -> «ИП»). */
export function getInitials(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter((word) => word !== '')
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toUpperCase()
}
