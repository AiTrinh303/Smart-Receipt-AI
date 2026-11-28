import { useMediaQuery } from '../../hooks/useMediaQuery'
import { isPlainLeftClick } from '../../navigation'
import { pageItems } from './pageItems'

interface PaginationProps {
  currentPage: number
  totalPages: number
  /** The real href of a page (so ctrl/cmd-click opens it in a new tab). */
  hrefForPage: (page: number) => string
  /** Called on a plain left click; modified clicks are left to the browser. */
  onPageChange: (page: number) => void
}

const TARGET = 'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control px-3 text-sm sm:min-h-0 sm:h-9 sm:min-w-9'

const LINK_CLASSES =
  `${TARGET} font-medium text-ink hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 ` +
  'focus-visible:outline-offset-2 focus-visible:outline-brand'

const CURRENT_CLASSES = `${TARGET} bg-brand font-semibold text-white`

const DISABLED_CLASSES = `${TARGET} font-medium text-ink-muted/50`

/** Page navigation for a long list: "‹ Previous", page numbers with "…"
 * for gaps, "Next ›" (below `sm`: "‹ Previous", "Page N of M", "Next ›").
 * Every page is a real `<a href>`; the current page is not a link but a
 * `aria-current="page"` item with a filled background and bold text (never
 * colour alone); Previous/Next at either end are `<span aria-disabled>`. */
function Pagination({ currentPage, totalPages, hrefForPage, onPageChange }: PaginationProps) {
  const isSmallScreen = useMediaQuery('(max-width: 639px)')

  const link = (page: number, label: string, ariaLabel?: string) => (
    <a
      href={hrefForPage(page)}
      aria-label={ariaLabel}
      onClick={(e) => {
        if (!isPlainLeftClick(e)) {
          return
        }
        e.preventDefault()
        onPageChange(page)
      }}
      className={LINK_CLASSES}
    >
      {label}
    </a>
  )

  const previous =
    currentPage > 1 ? (
      link(currentPage - 1, '‹ Previous', 'Previous page')
    ) : (
      <span aria-disabled="true" className={DISABLED_CLASSES}>
        ‹ Previous
      </span>
    )
  const next =
    currentPage < totalPages ? (
      link(currentPage + 1, 'Next ›', 'Next page')
    ) : (
      <span aria-disabled="true" className={DISABLED_CLASSES}>
        Next ›
      </span>
    )

  return (
    <nav aria-label="Pagination">
      <ul className="flex flex-wrap items-center gap-1">
        <li>{previous}</li>
        {isSmallScreen ? (
          <li>
            <span className="px-2 text-sm text-ink-muted">
              Page {currentPage} of {totalPages}
            </span>
          </li>
        ) : (
          pageItems(currentPage, totalPages).map((item, index) =>
            item === 'gap' ? (
              <li key={`gap-${index}`} aria-hidden="true" className="px-1 text-sm text-ink-muted">
                …
              </li>
            ) : (
              <li key={item}>
                {item === currentPage ? (
                  <span aria-current="page" className={CURRENT_CLASSES}>
                    {item}
                  </span>
                ) : (
                  link(item, String(item), `Page ${item}`)
                )}
              </li>
            ),
          )
        )}
        <li>{next}</li>
      </ul>
    </nav>
  )
}

export default Pagination
