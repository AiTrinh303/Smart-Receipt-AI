import { useEffect, useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReceiptItems from './ReceiptItems'
import ReceiptUpload from './ReceiptUpload'
import { chooseOption, optionLabels, selectControl, selectValue } from './test/select'

beforeEach(() => {
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const OBERAUDORF = { id: 'oberaudorf-bergblick', name: 'Oberaudorf Bergblick' }
const WALDGLUECK = { id: 'sankt-englmar-waldglueck', name: 'Sankt Englmar Waldglück' }

const DEFAULT_FACETS = {
  apartments: [
    { ...OBERAUDORF, count: 2 },
    { ...WALDGLUECK, count: 1 },
  ],
  total: 3,
  years: [2026, 2025],
  has_undated: false,
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    receipt_id: '11111111-1111-1111-1111-111111111111',
    line_index: 0,
    name: 'Milk',
    quantity: 2,
    unit_price: 1.5,
    line_total: 3.0,
    currency: 'EUR',
    purchase_date: '2026-01-15',
    store_name: 'Corner Store',
    apartment_id: OBERAUDORF.id,
    apartment_name: OBERAUDORF.name,
    status: 'needs_review',
    ...overrides,
  }
}

interface Routes {
  facets?: (urlString: string) => Promise<unknown>
  items?: (urlString: string) => Promise<unknown>
  get?: (receiptId: string) => Promise<unknown>
  apartments?: () => Promise<unknown>
}

function routeFetch(routes: Routes = {}) {
  return (url: unknown) => {
    const urlString = String(url)
    if (urlString.endsWith('/apartments')) {
      return routes.apartments
        ? routes.apartments()
        : Promise.resolve(jsonResponse(200, { items: [OBERAUDORF, WALDGLUECK], count: 2 }))
    }
    if (urlString.includes('/receipts/facets')) {
      return routes.facets
        ? routes.facets(urlString)
        : Promise.resolve(jsonResponse(200, DEFAULT_FACETS))
    }
    if (urlString.includes('/items?') || urlString.endsWith('/items')) {
      return routes.items
        ? routes.items(urlString)
        : Promise.reject(new Error(`Unexpected items call to ${urlString}`))
    }
    if (urlString.match(/\/receipts\/[0-9a-f-]+$/)) {
      const receiptId = urlString.split('/receipts/')[1]
      return routes.get
        ? routes.get(receiptId)
        : Promise.reject(new Error(`Unexpected GET call to ${urlString}`))
    }
    return Promise.reject(new Error(`Unexpected fetch call to ${urlString}`))
  }
}

/** Mirrors App.tsx's own key={locationKey}/popstate remount behavior, so
 * tests can exercise real navigation (which fully remounts ReceiptItems in
 * the real app) without rendering the whole App. */
function ItemsHarness() {
  const [key, setKey] = useState(() => window.location.search)
  useEffect(() => {
    const handlePopState = () => setKey(window.location.search)
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])
  return <ReceiptItems key={key} />
}

function mockMatchMedia(matches: boolean) {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }))
}

describe('ReceiptItems', () => {
  let fetchSpy: jest.Mock

  beforeEach(() => {
    fetchSpy = jest.fn().mockImplementation(routeFetch())
    global.fetch = fetchSpy as unknown as typeof fetch
  })

  afterEach(() => {
    // @ts-expect-error cleaning up the test-only global fetch stub
    delete global.fetch
    // @ts-expect-error cleaning up the test-only global matchMedia stub
    delete window.matchMedia
  })

  test('tab labels show no counts', async () => {
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 })) }),
    )

    render(<ReceiptItems />)

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'All apartments' })).toBeInTheDocument()
    })
    expect(screen.getByRole('tab', { name: OBERAUDORF.name })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: WALDGLUECK.name })).toBeInTheDocument()
  })

  test('rows render in the given order with money formatted per row currency', async () => {
    const rowA = makeRow({ line_index: 0, name: 'Milk', currency: 'EUR', unit_price: 1.5, line_total: 3.0 })
    const rowB = makeRow({
      receipt_id: '22222222-2222-2222-2222-222222222222',
      line_index: 0,
      name: 'Bread',
      currency: 'USD',
      unit_price: 2.0,
      line_total: 4.0,
    })
    fetchSpy.mockImplementation(
      routeFetch({
        items: () => Promise.resolve(jsonResponse(200, { items: [rowA, rowB], count: 2, total: 2 })),
      }),
    )

    render(<ReceiptItems />)

    await waitFor(() => {
      expect(screen.getByText('Milk')).toBeInTheDocument()
    })
    const rows = screen.getAllByRole('row').slice(1) // drop header row
    expect(rows[0]).toHaveTextContent('Milk')
    expect(rows[1]).toHaveTextContent('Bread')
    expect(screen.getByText('€1.50')).toBeInTheDocument()
    expect(screen.getByText('€3.00')).toBeInTheDocument()
    expect(screen.getByText('USD 2.00')).toBeInTheDocument()
    expect(screen.getByText('USD 4.00')).toBeInTheDocument()
  })

  test('null fields show "Not detected", never null/undefined/NaN', async () => {
    const row = makeRow({
      name: null,
      quantity: null,
      unit_price: null,
      line_total: null,
      currency: null,
      purchase_date: null,
      store_name: null,
    })
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [row], count: 1, total: 1 })) }),
    )

    render(<ReceiptItems />)

    await waitFor(() => {
      expect(screen.getAllByText('Not detected').length).toBeGreaterThan(0)
    })
    expect(document.body.textContent).not.toMatch(/\bnull\b/i)
    expect(document.body.textContent).not.toMatch(/\bundefined\b/i)
    expect(document.body.textContent).not.toMatch(/\bNaN\b/i)
  })

  test('the Apartment column appears only in the All apartments tab', async () => {
    const row = makeRow()
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [row], count: 1, total: 1 })) }),
    )

    // All apartments -- column shown
    const { unmount } = render(<ReceiptItems />)
    await waitFor(() => {
      expect(screen.getByText('Milk')).toBeInTheDocument()
    })
    expect(screen.getByRole('columnheader', { name: 'Apartment' })).toBeInTheDocument()
    unmount()

    // A specific apartment tab -- column hidden
    window.history.replaceState({}, '', `/?view=items&apartment=${OBERAUDORF.id}`)
    render(<ReceiptItems />)
    await waitFor(() => {
      expect(screen.getByText('Milk')).toBeInTheDocument()
    })
    expect(screen.queryByRole('columnheader', { name: 'Apartment' })).not.toBeInTheDocument()
  })

  test('a search sends q and updates the URL', async () => {
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        items: (urlString) => {
          calls.push(urlString)
          return Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 }))
        },
      }),
    )
    const user = userEvent.setup()
    render(<ItemsHarness />)
    await waitFor(() => {
      expect(screen.getByLabelText('Search items or stores')).toBeInTheDocument()
    })

    await user.type(screen.getByLabelText('Search items or stores'), 'milk')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => expect(window.location.search).toContain('q=milk'))
    const lastCall = calls[calls.length - 1]
    expect(lastCall).toContain('q=milk')
  })

  // --- Search and filter row -------------------------------------------------

  test('the search field: visible label, magnifier icon, placeholder, and a secondary "Search" button attached to its right edge', async () => {
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 })) }),
    )
    render(<ReceiptItems />)
    const input = await screen.findByLabelText('Search items or stores')

    // Then the input has its placeholder and keeps maxLength 100
    expect(input).toHaveAttribute('placeholder', 'e.g. Kaffee, Rossmann')
    expect(input).toHaveAttribute('maxLength', '100')
    // And a decorative magnifier sits inside the same wrapper
    expect((input.parentElement as HTMLElement).querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    // And the Search button is secondary (not the brand fill) and shares the input's border
    const search = screen.getByRole('button', { name: 'Search' })
    expect(search).toHaveAttribute('type', 'submit')
    expect(search.className).not.toMatch(/\bbg-brand\b/)
    expect(search).toHaveClass('-ml-px', 'rounded-r-md', 'border-border')
    expect(input).toHaveClass('rounded-l-md')
    // And there is no "×" while the field is empty, and no separate "Clear" button
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
  })

  test('typing shows "×" inside the field; it clears the text and the search, like the old "Clear" button', async () => {
    // Given a search already applied
    window.history.replaceState({}, '', '/?view=items&q=milk')
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 })) }),
    )
    const user = userEvent.setup()
    render(<ItemsHarness />)
    const input = await screen.findByLabelText('Search items or stores')
    expect(input).toHaveValue('milk')

    // When "×" (aria-label "Clear search") is clicked
    await user.click(screen.getByRole('button', { name: 'Clear search' }))

    // Then the field is empty and the search is gone from the URL
    await waitFor(() => expect(window.location.search).not.toContain('q='))
    expect(await screen.findByLabelText('Search items or stores')).toHaveValue('')
  })

  test('Enter submits the search; Tab goes input -> "×" -> Search -> Year', async () => {
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 })) }),
    )
    const user = userEvent.setup()
    render(<ItemsHarness />)
    const input = await screen.findByLabelText('Search items or stores')

    // Tab order while the field has text
    await user.click(input)
    await user.keyboard('kaffee')
    await user.tab()
    expect(screen.getByRole('button', { name: 'Clear search' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Search' })).toHaveFocus()
    await user.tab()
    expect(selectControl('Year')).toHaveFocus()

    // Enter in the field submits
    await user.click(screen.getByLabelText('Search items or stores'))
    await user.keyboard('{Enter}')
    await waitFor(() => expect(window.location.search).toContain('q=kaffee'))
  })

  test('row 1 is the full-width search, row 2 is Year, Status and Sort by as three equal columns; every control is 44px tall', async () => {
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 })) }),
    )
    render(<ReceiptItems />)
    const input = await screen.findByLabelText('Search items or stores')

    // Row 2: the same grid as History, holding exactly the three selects
    const row = selectControl('Year').closest('.grid') as HTMLElement
    expect(row).toHaveClass('grid-cols-1', 'md:grid-cols-3')
    expect(row.children).toHaveLength(3)
    expect(row).toContainElement(selectControl('Status'))
    expect(row).toContainElement(selectControl('Sort by'))
    // Row 1: the search form comes before it and is not part of the grid
    expect(row).not.toContainElement(input)
    expect(input.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Same height everywhere: h-11
    for (const control of [input, screen.getByRole('button', { name: 'Search' }), selectControl('Year'), selectControl('Status'), selectControl('Sort by')]) {
      expect(control).toHaveClass('h-11')
    }
  })

  test('one line between the filter row and the table: "N items" (also with several pages), no Clear filters without a filter -- as on History', async () => {
    // Given 60 items (three pages) and no filter or search
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [makeRow()], count: 1, total: 60 })) }),
    )
    render(<ReceiptItems />)
    await screen.findByText('Showing 1–20 of 60')

    // Then right after the filter grid comes the count line, then the (empty) scroll anchor, then the table
    const row = selectControl('Year').closest('.grid') as HTMLElement
    const line = row.nextElementSibling as HTMLElement
    expect(line).toContainElement(screen.getByText('60 items'))
    expect(screen.getByText('60 items')).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
    const anchor = line.nextElementSibling as HTMLElement
    expect(anchor.childElementCount).toBe(0)
    expect((anchor.nextElementSibling as HTMLElement).querySelector('table')).not.toBeNull()
  })

  test('the magnifier paints above the input: z-20, above the input\'s own (focus) stacking', async () => {
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 })) }),
    )
    render(<ReceiptItems />)
    const input = await screen.findByLabelText('Search items or stores')

    // Then the icon (positioned, before the positioned opaque input in DOM order) carries its own z-index;
    // without it the input's bg-surface paints over it in a real browser (jsdom can't see that)
    const icon = (input.parentElement as HTMLElement).querySelector('svg[aria-hidden="true"]') as SVGElement
    expect(icon).toHaveClass('absolute', 'z-20', 'pointer-events-none')
    expect(input).toHaveClass('relative', 'bg-surface', 'focus-visible:z-10')
  })

  test('with a search the count line reads: 12 items for "milch", with Clear filters; without one: 268 items', async () => {
    // Given a search that matches 12 items
    window.history.replaceState({}, '', '/?view=items&q=milch')
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [makeRow()], count: 1, total: 12 })) }),
    )
    const { unmount } = render(<ReceiptItems />)

    // Then the count line names the search, and Clear filters is offered
    expect(await screen.findByText('12 items for "milch"')).toHaveAttribute('role', 'status')
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
    unmount()

    // Given no search and 268 items
    window.history.replaceState({}, '', '/?view=items')
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [makeRow()], count: 1, total: 268 })) }),
    )
    render(<ReceiptItems />)

    // Then just the total, and no Clear filters
    expect(await screen.findByText('268 items')).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
  })

  test('the table sits inside one Card with its header row, like the History list', async () => {
    mockMatchMedia(false)
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [makeRow()], count: 1, total: 1 })) }),
    )
    render(<ReceiptItems />)
    const table = await screen.findByRole('table')

    // Then one Card (rounded-card, shadow) holds the table, header row included
    const card = table.closest('.rounded-card') as HTMLElement
    expect(card).toHaveClass('shadow-card', 'overflow-hidden')
    expect(card).toContainElement(screen.getByRole('columnheader', { name: 'Date' }))
    // And the header row uses History's header style (small muted text, a subtle divider)
    expect(screen.getByRole('columnheader', { name: 'Date' }).closest('tr')).toHaveClass(
      'text-xs',
      'text-ink-muted',
      'border-border-subtle',
    )
  })

  test('below sm the item rows sit inside one Card as a divided list, not separate bordered cards', async () => {
    mockMatchMedia(true)
    fetchSpy.mockImplementation(
      routeFetch({
        items: () =>
          Promise.resolve(
            jsonResponse(200, { items: [makeRow(), makeRow({ line_index: 1, name: 'Bread' })], count: 2, total: 2 }),
          ),
      }),
    )
    render(<ReceiptItems />)
    await screen.findByText('Bread')

    // Then both rows share one list inside one Card
    const rows = screen.getAllByRole('listitem')
    const list = rows[0].parentElement as HTMLElement
    expect(rows[1].parentElement).toBe(list)
    expect(list).toHaveClass('divide-y')
    expect(list.closest('.rounded-card')).toHaveClass('shadow-card')
    expect(rows[0].className).not.toMatch(/\bborder\b/)
  })

  test('active filters: Year and Status get the brand border/fill when set; Sort by never does', async () => {
    // Given Year, Status and a non-default sort in the URL
    window.history.replaceState({}, '', '/?view=items&year=2026&status=approved&sort=amount_desc')
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [makeRow()], count: 1, total: 1 })) }),
    )
    render(<ReceiptItems />)
    await screen.findByRole('combobox', { name: 'Year' })

    // Then Year and Status show as active, with their value as text (not colour alone)
    for (const [label, text] of [['Year', '2026'], ['Status', 'Approved']]) {
      expect(selectControl(label)).toHaveClass('border-brand', 'bg-brand-soft')
      expect(selectControl(label)).toHaveTextContent(text)
    }
    // And Sort by stays the plain control
    expect(selectControl('Sort by')).toHaveClass('border-border', 'bg-surface')
    expect(selectControl('Sort by')).not.toHaveClass('bg-brand-soft')
  })

  test('inactive filters keep the plain border and surface', async () => {
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [makeRow()], count: 1, total: 1 })) }),
    )
    render(<ReceiptItems />)
    await screen.findByRole('combobox', { name: 'Year' })
    for (const label of ['Year', 'Status', 'Sort by']) {
      expect(selectControl(label)).toHaveClass('border-border', 'bg-surface')
      expect(selectControl(label)).not.toHaveClass('border-brand')
    }
  })

  test('each filter sends its param and they combine', async () => {
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        items: (urlString) => {
          calls.push(urlString)
          return Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 }))
        },
      }),
    )
    const user = userEvent.setup()
    render(<ItemsHarness />)
    await waitFor(() => {
      expect(selectControl('Year')).toBeInTheDocument()
    })

    await chooseOption(user, 'Year', '2026')
    await waitFor(() => expect(window.location.search).toContain('year=2026'))

    await chooseOption(user, 'Status', 'Approved')
    await waitFor(() => expect(window.location.search).toContain('status=approved'))

    await user.click(screen.getByRole('tab', { name: OBERAUDORF.name }))
    await waitFor(() => expect(window.location.search).toContain(`apartment=${OBERAUDORF.id}`))

    const lastCall = calls[calls.length - 1]
    expect(lastCall).toContain('year=2026')
    expect(lastCall).toContain('status=approved')
    expect(lastCall).toContain(`apartment_id=${OBERAUDORF.id}`)
  })

  test('a URL with filters and q loads them on first render', async () => {
    window.history.replaceState(
      {},
      '',
      `/?view=items&apartment=${OBERAUDORF.id}&year=2026&status=needs_review&q=milk`,
    )
    let capturedUrl = ''
    fetchSpy.mockImplementation(
      routeFetch({
        items: (urlString) => {
          capturedUrl = urlString
          return Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 }))
        },
      }),
    )

    render(<ReceiptItems />)

    await waitFor(() => {
      expect(capturedUrl).toContain(`apartment_id=${OBERAUDORF.id}`)
    })
    expect(capturedUrl).toContain('year=2026')
    expect(capturedUrl).toContain('status=needs_review')
    expect(capturedUrl).toContain('q=milk')
    expect(screen.getByLabelText('Search items or stores')).toHaveValue('milk')
    expect(screen.getByRole('tab', { name: OBERAUDORF.name })).toHaveAttribute('aria-selected', 'true')
  })

  test('invalid URL values are ignored', async () => {
    window.history.replaceState(
      {},
      '',
      '/?view=items&apartment=does-not-exist&year=25&status=archived',
    )
    let capturedUrl = ''
    fetchSpy.mockImplementation(
      routeFetch({
        items: (urlString) => {
          capturedUrl = urlString
          return Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 }))
        },
      }),
    )

    render(<ReceiptItems />)

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'All apartments' })).toHaveAttribute('aria-selected', 'true')
    })
    expect(capturedUrl).not.toContain('apartment_id=')
    expect(capturedUrl).not.toContain('year=')
    expect(capturedUrl).not.toContain('status=')
  })

  test('changing a filter, the search or the sort on page 3 goes back to page 1', async () => {
    // Given page 3 of 60 items
    window.history.replaceState({}, '', '/?view=items&page=3')
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        items: (urlString) => {
          calls.push(urlString)
          return Promise.resolve(jsonResponse(200, { items: [makeRow()], count: 1, total: 60 }))
        },
      }),
    )
    const user = userEvent.setup()
    render(<ItemsHarness />)
    await screen.findByText('Showing 41–60 of 60')

    // When the Status filter changes: back to page 1
    await chooseOption(user, 'Status', 'Approved')
    await waitFor(() => expect(window.location.search).toContain('status=approved'))
    expect(window.location.search).not.toContain('page=')
    await waitFor(() => expect(calls[calls.length - 1]).toContain('offset=0'))

    // When on page 2 a search is submitted: back to page 1 again
    await user.click(await screen.findByRole('link', { name: 'Page 2' }))
    await waitFor(() => expect(window.location.search).toContain('page=2'))
    await user.type(await screen.findByLabelText('Search items or stores'), 'milch')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(window.location.search).toContain('q=milch'))
    expect(window.location.search).not.toContain('page=')

    // And a sort change from page 2 also starts again at page 1
    await user.click(await screen.findByRole('link', { name: 'Page 2' }))
    await waitFor(() => expect(window.location.search).toContain('page=2'))
    await chooseOption(user, 'Sort by', 'Store (A-Z)')
    await waitFor(() => expect(window.location.search).toContain('sort=store'))
    expect(window.location.search).not.toContain('page=')
  })

  test('with more than 20 items: "Showing 1–20 of N" and the pagination under the table; a page link loads that page and focuses the summary', async () => {
    // Given 268 items
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        items: (urlString) => {
          calls.push(urlString)
          return Promise.resolve(jsonResponse(200, { items: [makeRow()], count: 1, total: 268 }))
        },
      }),
    )
    const user = userEvent.setup()
    render(<ItemsHarness />)

    // Then page 1 asks for 20 from offset 0, shows the range, and neither "Show more" nor "N of M items" remain
    const summary = await screen.findByText('Showing 1–20 of 268')
    expect(summary).toHaveAttribute('role', 'status')
    const first = new URL(calls[0], 'http://x').searchParams
    expect(first.get('limit')).toBe('20')
    expect(first.get('offset')).toBe('0')
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
    expect(screen.queryByText(/of 268 items/)).not.toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Pagination' })
    expect(within(nav).getByText('1')).toHaveAttribute('aria-current', 'page')

    // When page 2 is chosen
    await user.click(within(nav).getByRole('link', { name: 'Page 2' }))

    // Then the URL, the request offset and the range follow, and focus is on the summary
    await waitFor(() => expect(window.location.search).toBe('?view=items&page=2'))
    await screen.findByText('Showing 21–40 of 268')
    expect(new URL(calls[calls.length - 1], 'http://x').searchParams.get('offset')).toBe('20')
    await waitFor(() => expect(screen.getByText('Showing 21–40 of 268')).toHaveFocus())
  })

  test('one page only: "N items" above the table and no pagination', async () => {
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [makeRow()], count: 1, total: 1 })) }),
    )
    render(<ReceiptItems />)
    expect(await screen.findByText('1 item')).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument()
  })

  test('a page from the URL is fetched directly; invalid -> page 1; too large -> the last page, with the URL corrected', async () => {
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        items: (urlString) => {
          calls.push(urlString)
          return Promise.resolve(jsonResponse(200, { items: [makeRow()], count: 1, total: 50 }))
        },
      }),
    )

    window.history.replaceState({}, '', '/?view=items&page=3')
    const first = render(<ReceiptItems />)
    await screen.findByText('Showing 41–50 of 50')
    expect(new URL(calls[calls.length - 1], 'http://x').searchParams.get('offset')).toBe('40')
    first.unmount()

    window.history.replaceState({}, '', '/?view=items&page=0')
    const second = render(<ReceiptItems />)
    await screen.findByText('Showing 1–20 of 50')
    second.unmount()

    window.history.replaceState({}, '', '/?view=items&page=7')
    render(<ReceiptItems />)
    await screen.findByText('Showing 41–50 of 50')
    expect(window.location.search).toBe('?view=items&page=3')
  })

  test('on a later page the row links carry the page in `from`, and the first row of a page has no stronger divider', async () => {
    // Given page 2 whose rows belong to two receipts
    window.history.replaceState({}, '', '/?view=items&page=2')
    const B = '22222222-2222-2222-2222-222222222222'
    fetchSpy.mockImplementation(
      routeFetch({
        items: () =>
          Promise.resolve(
            jsonResponse(200, {
              items: [makeRow({ name: 'A0' }), makeRow({ receipt_id: B, name: 'B0' })],
              count: 2,
              total: 30,
            }),
          ),
      }),
    )
    render(<ReceiptItems />)

    // Then the link carries this page
    const link = await screen.findByRole('link', { name: 'A0' })
    expect(link).toHaveAttribute(
      'href',
      `/?receipt=11111111-1111-1111-1111-111111111111&from=${encodeURIComponent('?view=items&page=2')}`,
    )
    // And grouping restarts per page: no top divider on the page's first row, the stronger one at the receipt change
    expect((link.closest('tr') as HTMLElement).className).not.toMatch(/border-t/)
    expect(screen.getByRole('link', { name: 'B0' }).closest('tr')).toHaveClass('border-border/40')
  })

  test('clicking an item name navigates to ?receipt=<id> with the from mechanism, and the back link reads "Back to items" and restores tab, filters and search', async () => {
    window.history.replaceState(
      {},
      '',
      `/?view=items&apartment=${OBERAUDORF.id}&status=needs_review&q=milk`,
    )
    const row = makeRow()
    fetchSpy.mockImplementation(
      routeFetch({
        items: () => Promise.resolve(jsonResponse(200, { items: [row], count: 1, total: 1 })),
        get: (receiptId) =>
          Promise.resolve(
            jsonResponse(200, {
              receipt_id: receiptId,
              store_name: 'Corner Store',
              purchase_date: '2026-01-15',
              currency: 'EUR',
              items: [],
              discounts: [],
              taxes: [],
              total: 3.0,
              warnings: [],
              edited: false,
              edited_at: null,
              apartment_id: OBERAUDORF.id,
              apartment_name: OBERAUDORF.name,
              status: 'needs_review',
              original_filename: 'receipt.jpg',
              content_type: 'image/jpeg',
              created_at: '2026-01-15T10:00:00+00:00',
              updated_at: '2026-01-15T10:00:00+00:00',
            }),
          ),
      }),
    )
    const user = userEvent.setup()
    const { unmount } = render(<ReceiptItems />)
    await waitFor(() => {
      expect(screen.getByText('Milk')).toBeInTheDocument()
    })
    const originalSearch = window.location.search

    await user.click(screen.getByRole('link', { name: 'Milk' }))

    await waitFor(() => {
      expect(window.location.search).toContain(`receipt=${row.receipt_id}`)
    })
    expect(window.location.search).toContain(`from=${encodeURIComponent(originalSearch)}`)
    unmount()

    // Now render ReceiptUpload at this URL, as App.tsx would
    render(<ReceiptUpload />)
    await waitFor(() => {
      expect(screen.getByText('Corner Store')).toBeInTheDocument()
    })
    const backLink = screen.getByRole('link', { name: /back to items/i })
    expect(backLink).toBeInTheDocument()

    await user.click(backLink)

    await waitFor(() => {
      expect(window.location.search).toBe(originalSearch)
    })
  })

  test('small screen (matchMedia matches): cards render, never the table', async () => {
    mockMatchMedia(true)
    const row = makeRow()
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [row], count: 1, total: 1 })) }),
    )

    render(<ReceiptItems />)

    await waitFor(() => {
      expect(screen.getByText('Milk')).toBeInTheDocument()
    })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0)
  })

  test('large screen (matchMedia does not match): the table renders, no cards', async () => {
    mockMatchMedia(false)
    const row = makeRow()
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [row], count: 1, total: 1 })) }),
    )

    render(<ReceiptItems />)

    await waitFor(() => {
      expect(screen.getByText('Milk')).toBeInTheDocument()
    })
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })

  test('loading state is shown while the request is pending', async () => {
    const deferred = createDeferred<unknown>()
    fetchSpy.mockImplementation(routeFetch({ facets: () => deferred.promise }))

    render(<ReceiptItems />)

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Loading items...')).toBeInTheDocument()

    deferred.resolve(jsonResponse(200, DEFAULT_FACETS))

    await waitFor(() => {
      expect(screen.queryByText('Loading items...')).not.toBeInTheDocument()
    })
  })

  test('error response -> error shown, Retry calls everything again', async () => {
    let callCount = 0
    fetchSpy.mockImplementation(
      routeFetch({
        facets: () => {
          callCount += 1
          if (callCount === 1) {
            return Promise.resolve(jsonResponse(500, { detail: 'Internal error' }))
          }
          return Promise.resolve(jsonResponse(200, DEFAULT_FACETS))
        },
        items: () => Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 })),
      }),
    )
    const user = userEvent.setup()

    render(<ReceiptItems />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not load items. Please try again.')
    })

    await user.click(screen.getByRole('button', { name: /retry/i }))

    await waitFor(() => {
      expect(screen.getByText('No items yet. Upload a receipt.')).toBeInTheDocument()
    })
    expect(callCount).toBe(2)
  })

  test('empty, unfiltered -> "No items yet. Upload a receipt."', async () => {
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 })) }),
    )

    render(<ReceiptItems />)

    await waitFor(() => {
      expect(screen.getByText('No items yet. Upload a receipt.')).toBeInTheDocument()
    })
  })

  test('empty with a filter active -> "No items match these filters." with Clear filters', async () => {
    window.history.replaceState({}, '', '/?view=items&status=approved')
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 })) }),
    )

    render(<ReceiptItems />)

    await waitFor(() => {
      expect(screen.getByText('No items match these filters.')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
  })

  test('a reply to an older (stale) request never overwrites the newer result', async () => {
    const olderRow = makeRow({ name: 'Stale Item' })
    const newerRow = makeRow({ receipt_id: 'fresh', name: 'Fresh Item' })
    const olderFacets = createDeferred<unknown>()
    let facetsCallCount = 0

    fetchSpy.mockImplementation(
      routeFetch({
        facets: () => {
          facetsCallCount += 1
          // The first (older) request's facets call never resolves until
          // we explicitly do so below, well after the second request
          // finishes -- simulating an out-of-order network reply.
          return facetsCallCount === 1 ? olderFacets.promise : Promise.resolve(jsonResponse(200, DEFAULT_FACETS))
        },
        items: (urlString) =>
          Promise.resolve(
            jsonResponse(
              200,
              urlString.includes('status=approved')
                ? { items: [olderRow], count: 1, total: 1 }
                : { items: [newerRow], count: 1, total: 1 },
            ),
          ),
      }),
    )

    // Given the older (stale) request starts first, for a URL with a filter
    window.history.replaceState({}, '', '/?view=items&status=approved')
    const { unmount } = render(<ReceiptItems />)

    // When a newer request starts (remount, as a real navigation would do)
    // before the older one has resolved
    unmount()
    window.history.replaceState({}, '', '/?view=items')
    render(<ReceiptItems />)

    await waitFor(() => {
      expect(screen.getByText('Fresh Item')).toBeInTheDocument()
    })

    // And only then does the older, now-stale request resolve
    olderFacets.resolve(jsonResponse(200, DEFAULT_FACETS))

    // Then the stale response never overwrites the newer, already-shown result
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByText('Stale Item')).not.toBeInTheDocument()
    expect(screen.getByText('Fresh Item')).toBeInTheDocument()
  })

  // --- Date, apartment, status, clamping (table redesign) -----------------

  test('a valid ISO date shows as DD.MM.YYYY', async () => {
    const row = makeRow({ purchase_date: '2026-06-02' })
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [row], count: 1, total: 1 })) }),
    )

    render(<ReceiptItems />)

    await waitFor(() => {
      expect(screen.getByText('02.06.2026')).toBeInTheDocument()
    })
  })

  test('a raw, unrecognized stored date shows the raw text with a hidden "Date not recognized" and a title', async () => {
    const row = makeRow({ purchase_date: '02.06.2026' })
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [row], count: 1, total: 1 })) }),
    )

    render(<ReceiptItems />)

    await waitFor(() => {
      expect(screen.getByText('02.06.2026')).toBeInTheDocument()
    })
    expect(screen.getByText('Date not recognized')).toBeInTheDocument()
    expect(
      screen.getByTitle(
        'This date could not be read as a valid date. Open the receipt and fix it with Edit.',
      ),
    ).toBeInTheDocument()
  })

  test('a null date shows a dash with hidden "Not detected"', async () => {
    const row = makeRow({ purchase_date: null })
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [row], count: 1, total: 1 })) }),
    )

    render(<ReceiptItems />)

    await waitFor(() => {
      expect(screen.getByText('Milk')).toBeInTheDocument()
    })
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getAllByText('Not detected').length).toBeGreaterThan(0)
  })

  test('the apartment cell shows the short name with the full name in its title, and is absent in a single-apartment tab', async () => {
    const row = makeRow({ apartment_name: 'Fewo JoJo - Sankt Englmar - Waldglück' })
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [row], count: 1, total: 1 })) }),
    )

    const { unmount } = render(<ReceiptItems />)
    await waitFor(() => {
      expect(screen.getByText('Waldglück')).toBeInTheDocument()
    })
    expect(screen.getByTitle('Fewo JoJo - Sankt Englmar - Waldglück')).toBeInTheDocument()
    unmount()

    window.history.replaceState({}, '', `/?view=items&apartment=${OBERAUDORF.id}`)
    render(<ReceiptItems />)
    await waitFor(() => {
      expect(screen.getByText('Milk')).toBeInTheDocument()
    })
    expect(screen.queryByText('Waldglück')).not.toBeInTheDocument()
  })

  test('the status badge text is shown per row', async () => {
    const row = makeRow({ status: 'approved' })
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [row], count: 1, total: 1 })) }),
    )

    render(<ReceiptItems />)

    await waitFor(() => {
      expect(screen.getByText('Milk')).toBeInTheDocument()
    })
    expect(screen.getByRole('table')).toHaveTextContent('Approved')
  })

  test('a long item name and a long store name both carry a title with the full text', async () => {
    const longName = 'A'.repeat(120)
    const longStore = 'B'.repeat(80)
    const row = makeRow({ name: longName, store_name: longStore })
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [row], count: 1, total: 1 })) }),
    )

    render(<ReceiptItems />)

    await waitFor(() => {
      expect(screen.getByTitle(longName)).toBeInTheDocument()
    })
    expect(screen.getByTitle(longStore)).toBeInTheDocument()
  })

  test('money text is unchanged ("€2.23")', async () => {
    const row = makeRow({ unit_price: 2.23, currency: 'EUR' })
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [row], count: 1, total: 1 })) }),
    )

    render(<ReceiptItems />)

    await waitFor(() => {
      expect(screen.getByText('€2.23')).toBeInTheDocument()
    })
  })

  test('the count line shows the total with the search, and Clear filters resets the filters and search', async () => {
    window.history.replaceState(
      {},
      '',
      `/?view=items&apartment=${WALDGLUECK.id}&year=2026&status=approved&q=milch`,
    )
    const row = makeRow({ apartment_id: WALDGLUECK.id, apartment_name: WALDGLUECK.name })
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [row], count: 1, total: 1 })) }),
    )
    const user = userEvent.setup()

    render(<ItemsHarness />)

    // Then the count line names the search (the selects themselves show the year and status)
    await waitFor(() => {
      expect(screen.getByText('1 item for "milch"')).toHaveAttribute('role', 'status')
    })
    expect(screen.queryByText(`${WALDGLUECK.name} · 2026 · Approved · "milch"`)).not.toBeInTheDocument()
    const clearButtons = screen.getAllByRole('button', { name: 'Clear filters' })
    expect(clearButtons.length).toBeGreaterThan(0)

    await user.click(clearButtons[0])

    await waitFor(() => {
      expect(window.location.search).not.toContain('year=')
    })
    expect(window.location.search).not.toContain('status=')
    expect(window.location.search).not.toContain('q=')
    expect(window.location.search).toContain(`apartment=${WALDGLUECK.id}`)
  })

  test('the item link keeps its href and the from mechanism', async () => {
    const row = makeRow()
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [row], count: 1, total: 1 })) }),
    )

    render(<ReceiptItems />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Milk' })).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: 'Milk' })).toHaveAttribute(
      'href',
      `/?receipt=${row.receipt_id}`,
    )
  })

  // --- Tabs like History, whole-row links, alignment, receipt grouping ----

  test('apartment tabs show the short name with a tone dot and no count; the full name is the accessible name and title', async () => {
    // Given facets with a three-segment apartment name
    const threeSegment = { id: 'oberaudorf-bergblick', name: 'Fewo JoJo - Oberaudorf - Bergblick', count: 5 }
    fetchSpy.mockImplementation(
      routeFetch({
        facets: () =>
          Promise.resolve(jsonResponse(200, { ...DEFAULT_FACETS, apartments: [threeSegment], total: 5 })),
        items: () => Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 })),
      }),
    )
    render(<ReceiptItems />)

    // Then the tab reads just "Bergblick", named and titled with the full name, with the sky dot
    const tab = await screen.findByRole('tab', { name: threeSegment.name })
    expect(tab).toHaveTextContent(/^Bergblick$/)
    expect(tab).toHaveAttribute('title', threeSegment.name)
    expect(tab.querySelector('[aria-hidden="true"].bg-apartment-sky')).not.toBeNull()
  })

  test('each row is one whole-row link: plain item text, the from href, a plain click navigates, ctrl-click is left to the browser', async () => {
    // Given an apartment tab is active (so the link carries `from`)
    window.history.replaceState({}, '', `/?view=items&apartment=${OBERAUDORF.id}`)
    const row = makeRow()
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [row], count: 1, total: 1 })) }),
    )
    render(<ReceiptItems />)
    const link = await screen.findByRole('link', { name: 'Milk' })

    // Then it's the row's only link, not underlined, with the full href including `from`
    const tableRow = link.closest('tr') as HTMLElement
    expect(tableRow).toHaveClass('relative')
    expect(tableRow.querySelectorAll('a')).toHaveLength(1)
    expect(link.className).not.toMatch(/\bunderline\b/)
    expect(link.className).toContain("after:absolute")
    expect(link).toHaveAttribute(
      'href',
      `/?receipt=${row.receipt_id}&from=${encodeURIComponent(`?view=items&apartment=${OBERAUDORF.id}`)}`,
    )

    // When ctrl-clicked, the browser's own handling is not prevented (new tab)
    const ctrlClick = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })
    link.dispatchEvent(ctrlClick)
    expect(ctrlClick.defaultPrevented).toBe(false)

    // When plainly clicked, it navigates in place to the same receipt URL
    const plainClick = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(plainClick)
    expect(plainClick.defaultPrevented).toBe(true)
    expect(window.location.search).toBe(link.getAttribute('href')?.slice(1))
  })

  test('Store is set apart from Line total, and Status (header and cell) is right-aligned', async () => {
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [makeRow()], count: 1, total: 1 })) }),
    )
    render(<ReceiptItems />)
    const link = await screen.findByRole('link', { name: 'Milk' })

    // Then Store has extra left padding, and Status is right-aligned in the header and the row
    expect(screen.getByRole('columnheader', { name: 'Store' })).toHaveClass('pl-4')
    expect(screen.getByRole('columnheader', { name: 'Status' })).toHaveClass('text-right')
    const cells = (link.closest('tr') as HTMLElement).querySelectorAll('td')
    expect(cells[cells.length - 1]).toHaveClass('text-right')
    expect(cells[cells.length - 1]).toHaveTextContent('Needs review')
  })

  test('rows of the same receipt share the light divider; a new receipt starts with a stronger one, in any sort order', async () => {
    // Given rows sorted so one receipt's lines are split up: A0, A1, B0, A2
    const A = '11111111-1111-1111-1111-111111111111'
    const B = '22222222-2222-2222-2222-222222222222'
    const rows = [
      makeRow({ receipt_id: A, line_index: 0, name: 'A0' }),
      makeRow({ receipt_id: A, line_index: 1, name: 'A1' }),
      makeRow({ receipt_id: B, line_index: 0, name: 'B0' }),
      makeRow({ receipt_id: A, line_index: 2, name: 'A2' }),
    ]
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: rows, count: 4, total: 4 })) }),
    )
    render(<ReceiptItems />)
    await screen.findByRole('link', { name: 'A0' })
    const tr = (name: string) => screen.getByRole('link', { name }).closest('tr') as HTMLElement

    // Then the first row has no top divider, a same-receipt row the light one, and each change of receipt the stronger one
    expect(tr('A0').className).not.toMatch(/border-t/)
    expect(tr('A1')).toHaveClass('border-border-subtle')
    expect(tr('B0')).toHaveClass('border-border/40')
    expect(tr('A2')).toHaveClass('border-border/40')
  })

  // --- Sorting --------------------------------------------------------------

  test('the default sort is not sent and not shown in the URL', async () => {
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        items: (urlString) => {
          calls.push(urlString)
          return Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 }))
        },
      }),
    )

    render(<ReceiptItems />)

    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0)
    })
    expect(calls[0]).toContain('sort=date_desc')
    expect(window.location.search).not.toContain('sort=')
    expect(selectValue(selectControl('Sort by'))).toBe('date_desc')
  })

  test('choosing a sort sends it, updates the URL, and resets paging', async () => {
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        items: (urlString) => {
          calls.push(urlString)
          return Promise.resolve(jsonResponse(200, { items: [makeRow()], count: 1, total: 5 }))
        },
      }),
    )
    const user = userEvent.setup()
    render(<ItemsHarness />)
    await waitFor(() => {
      expect(selectControl('Sort by')).toBeInTheDocument()
    })

    await chooseOption(user, 'Sort by', 'Amount (high to low)')

    await waitFor(() => expect(window.location.search).toContain('sort=amount_desc'))
    const lastCall = calls[calls.length - 1]
    expect(lastCall).toContain('sort=amount_desc')
    expect(lastCall).toContain('offset=0')
  })

  test('an invalid sort value in the URL is ignored, falling back to the default', async () => {
    window.history.replaceState({}, '', '/?view=items&sort=not-a-real-sort')
    let capturedUrl = ''
    fetchSpy.mockImplementation(
      routeFetch({
        items: (urlString) => {
          capturedUrl = urlString
          return Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 }))
        },
      }),
    )

    render(<ReceiptItems />)

    await waitFor(() => {
      expect(capturedUrl).not.toBe('')
    })
    expect(capturedUrl).not.toContain('sort=not-a-real-sort')
    expect(capturedUrl).toContain('sort=date_desc')
    expect(selectValue(selectControl('Sort by'))).toBe('date_desc')
  })

  test('a non-default sort in the URL loads on first render and sends it', async () => {
    window.history.replaceState({}, '', '/?view=items&sort=store')
    let capturedUrl = ''
    fetchSpy.mockImplementation(
      routeFetch({
        items: (urlString) => {
          capturedUrl = urlString
          return Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 }))
        },
      }),
    )

    render(<ReceiptItems />)

    await waitFor(() => {
      expect(capturedUrl).toContain('sort=store')
    })
    expect(selectValue(selectControl('Sort by'))).toBe('store')
  })

  test('Back/Forward restores the previously selected sort', async () => {
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        items: (urlString) => {
          calls.push(urlString)
          return Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 }))
        },
      }),
    )
    const user = userEvent.setup()
    render(<ItemsHarness />)
    await waitFor(() => {
      expect(selectControl('Sort by')).toBeInTheDocument()
    })

    await chooseOption(user, 'Sort by', 'Store (A-Z)')
    await waitFor(() => expect(window.location.search).toContain('sort=store'))

    // Simulate the browser's Back button: pop to the prior history entry and
    // dispatch the real popstate event ItemsHarness listens for.
    window.history.back()
    await waitFor(() => {
      expect(window.location.search).not.toContain('sort=')
    })
    await waitFor(() => {
      expect(selectValue(selectControl('Sort by'))).toBe('date_desc')
    })

    window.history.forward()
    await waitFor(() => {
      expect(window.location.search).toContain('sort=store')
    })
    await waitFor(() => {
      expect(selectValue(selectControl('Sort by'))).toBe('store')
    })
  })

  test('the card variant shows "date · store", the Qty/Unit price/Line total labels, and the badges', async () => {
    mockMatchMedia(true)
    const row = makeRow({
      purchase_date: '2026-06-02',
      store_name: 'Corner Store',
      status: 'approved',
      apartment_name: 'Fewo JoJo - Sankt Englmar - Waldglück',
    })
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [row], count: 1, total: 1 })) }),
    )

    render(<ReceiptItems />)

    await waitFor(() => {
      expect(screen.getByText('Milk')).toBeInTheDocument()
    })
    const card = screen.getByText('Milk').closest('li') as HTMLElement
    expect(card).toHaveTextContent('02.06.2026 · Corner Store')
    expect(card).toHaveTextContent('Qty')
    expect(card).toHaveTextContent('Unit price')
    expect(card).toHaveTextContent('Line total')
    expect(card).toHaveTextContent('Waldglück')
    expect(card).toHaveTextContent('Approved')
  })
})
