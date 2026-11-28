import { render, screen, within } from '@testing-library/react'
import Pagination from './Pagination'
import { pageItems } from './pageItems'

afterEach(() => {
  // @ts-expect-error removing a per-test matchMedia stub
  delete window.matchMedia
})

function renderPagination(currentPage: number, totalPages: number, onPageChange = jest.fn()) {
  render(
    <Pagination
      currentPage={currentPage}
      totalPages={totalPages}
      hrefForPage={(page) => `/?view=history&page=${page}`}
      onPageChange={onPageChange}
    />,
  )
  return { nav: screen.getByRole('navigation', { name: 'Pagination' }), onPageChange }
}

describe('pageItems', () => {
  test.each<[number, number, (number | 'gap')[]]>([
    [1, 1, [1]],
    [1, 2, [1, 2]],
    [2, 3, [1, 2, 3]],
    [1, 8, [1, 2, 'gap', 8]],
    [3, 8, [1, 2, 3, 4, 'gap', 8]],
    [4, 8, [1, 2, 3, 4, 5, 'gap', 8]],
    [5, 10, [1, 'gap', 4, 5, 6, 'gap', 10]],
    [8, 8, [1, 'gap', 7, 8]],
    [6, 8, [1, 'gap', 5, 6, 7, 8]],
  ])('page %i of %i -> %j', (current, total, expected) => {
    // Given a current page and a total; Then first, last, current +-1 show,
    // with "gap" for skipped runs of 2+ pages (a single skipped page is shown instead)
    expect(pageItems(current, total)).toEqual(expected)
  })

  test('no pages -> nothing', () => {
    expect(pageItems(1, 0)).toEqual([])
  })
})

test('a nav "Pagination" with Previous, the page links, "…" for gaps, and Next', () => {
  // Given page 5 of 10
  const { nav } = renderPagination(5, 10)

  // Then every page shown is a real link with its href, except the current one
  for (const page of [1, 4, 6, 10]) {
    expect(within(nav).getByRole('link', { name: `Page ${page}` })).toHaveAttribute('href', `/?view=history&page=${page}`)
  }
  expect(within(nav).getAllByText('…')).toHaveLength(2)
  expect(within(nav).getByRole('link', { name: 'Previous page' })).toHaveAttribute('href', '/?view=history&page=4')
  expect(within(nav).getByRole('link', { name: 'Next page' })).toHaveAttribute('href', '/?view=history&page=6')
})

test('the current page is not a link: aria-current="page", filled and bold', () => {
  const { nav } = renderPagination(5, 10)
  const current = within(nav).getByText('5')
  expect(current.tagName).toBe('SPAN')
  expect(current).toHaveAttribute('aria-current', 'page')
  expect(current).toHaveClass('bg-brand', 'font-semibold', 'text-white')
  expect(within(nav).queryByRole('link', { name: 'Page 5' })).not.toBeInTheDocument()
})

test('on the first page Previous is a disabled span; on the last page Next is', () => {
  const first = renderPagination(1, 3)
  expect(within(first.nav).getByText('‹ Previous')).toHaveAttribute('aria-disabled', 'true')
  expect(within(first.nav).queryByRole('link', { name: 'Previous page' })).not.toBeInTheDocument()
  expect(within(first.nav).getByRole('link', { name: 'Next page' })).toBeInTheDocument()
})

test('on the last page Next is a disabled span', () => {
  const { nav } = renderPagination(3, 3)
  expect(within(nav).getByText('Next ›')).toHaveAttribute('aria-disabled', 'true')
  expect(within(nav).queryByRole('link', { name: 'Next page' })).not.toBeInTheDocument()
})

test('a plain click calls onPageChange and is handled in place; ctrl/cmd-click is left to the browser', () => {
  const { nav, onPageChange } = renderPagination(1, 5)
  const page2 = within(nav).getByRole('link', { name: 'Page 2' })

  const ctrl = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })
  page2.dispatchEvent(ctrl)
  expect(ctrl.defaultPrevented).toBe(false)
  const meta = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true })
  page2.dispatchEvent(meta)
  expect(meta.defaultPrevented).toBe(false)
  expect(onPageChange).not.toHaveBeenCalled()

  const plain = new MouseEvent('click', { bubbles: true, cancelable: true })
  page2.dispatchEvent(plain)
  expect(plain.defaultPrevented).toBe(true)
  expect(onPageChange).toHaveBeenCalledWith(2)
})

test('below sm: only Previous, "Page N of M" and Next -- no page numbers', () => {
  // Given a small screen
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: query === '(max-width: 639px)',
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  })) as unknown as typeof window.matchMedia
  const { nav } = renderPagination(3, 8)

  // Then the compact form shows
  expect(within(nav).getByText('Page 3 of 8')).toBeInTheDocument()
  expect(within(nav).queryByRole('link', { name: 'Page 2' })).not.toBeInTheDocument()
  expect(within(nav).getByRole('link', { name: 'Previous page' })).toBeInTheDocument()
  expect(within(nav).getByRole('link', { name: 'Next page' })).toBeInTheDocument()
  // And every control keeps the 44px minimum below sm
  expect(within(nav).getByRole('link', { name: 'Next page' })).toHaveClass('min-h-[44px]', 'min-w-[44px]')
})
