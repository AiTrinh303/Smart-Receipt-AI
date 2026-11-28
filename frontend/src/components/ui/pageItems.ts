export type PageItem = number | 'gap'

/** Which page numbers to show: the first, the last, the current page and
 * its two neighbours, with "…" (`'gap'`) for every skipped run -- except
 * that a run of exactly one page shows that page instead, since an
 * ellipsis hiding a single number would be no shorter. */
export function pageItems(currentPage: number, totalPages: number): PageItem[] {
  if (totalPages < 1) {
    return []
  }
  const wanted = new Set<number>([1, totalPages, currentPage - 1, currentPage, currentPage + 1])
  const pages = Array.from(wanted)
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b)

  const items: PageItem[] = []
  pages.forEach((page, index) => {
    const previous = pages[index - 1]
    if (previous !== undefined) {
      if (page - previous === 2) {
        items.push(previous + 1)
      } else if (page - previous > 2) {
        items.push('gap')
      }
    }
    items.push(page)
  })
  return items
}
