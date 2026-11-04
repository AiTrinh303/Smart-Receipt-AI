import { useEffect, useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReceiptItems from './ReceiptItems'
import ReceiptUpload from './ReceiptUpload'

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
    expect(screen.getByText('EUR 1.50')).toBeInTheDocument()
    expect(screen.getByText('EUR 3.00')).toBeInTheDocument()
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
      expect(screen.getByLabelText('Year')).toBeInTheDocument()
    })

    await user.selectOptions(screen.getByLabelText('Year'), '2026')
    await waitFor(() => expect(window.location.search).toContain('year=2026'))

    await user.selectOptions(screen.getByLabelText('Status'), 'Approved')
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

  test('changing a filter resets to the first page', async () => {
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        items: (urlString) => {
          calls.push(urlString)
          return Promise.resolve(
            jsonResponse(200, { items: [makeRow()], count: 1, total: 5 }),
          )
        },
      }),
    )
    const user = userEvent.setup()
    render(<ItemsHarness />)
    await waitFor(() => {
      expect(screen.getByText('Show more')).toBeInTheDocument()
    })

    await user.selectOptions(screen.getByLabelText('Status'), 'Approved')

    await waitFor(() => expect(window.location.search).toContain('status=approved'))
    const lastCall = calls[calls.length - 1]
    expect(lastCall).toContain('offset=0')
  })

  test('"Show more" sends offset and appends, and disappears at the end', async () => {
    const firstPage = Array.from({ length: 2 }, (_, i) =>
      makeRow({ receipt_id: `page1-${i}`, name: `Item ${i}` }),
    )
    const secondPage = [makeRow({ receipt_id: 'page2-0', name: 'Item 2' })]
    let callCount = 0
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        items: (urlString) => {
          calls.push(urlString)
          callCount += 1
          if (callCount === 1) {
            return Promise.resolve(jsonResponse(200, { items: firstPage, count: 2, total: 3 }))
          }
          return Promise.resolve(jsonResponse(200, { items: secondPage, count: 1, total: 3 }))
        },
      }),
    )
    const user = userEvent.setup()
    render(<ReceiptItems />)

    await waitFor(() => {
      expect(screen.getByText('2 of 3 items')).toBeInTheDocument()
    })
    expect(screen.getByText('Item 0')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show more' }))

    await waitFor(() => {
      expect(screen.getByText('3 of 3 items')).toBeInTheDocument()
    })
    // The first page's rows are still shown -- appended, not replaced
    expect(screen.getByText('Item 0')).toBeInTheDocument()
    expect(screen.getByText('Item 2')).toBeInTheDocument()
    expect(calls[1]).toContain('offset=2')
    // Nothing left to show -- the button is gone
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
  })

  test('a failed "Show more" keeps the rows shown and shows an error with Retry', async () => {
    const firstPage = [makeRow({ name: 'Item 0' })]
    let callCount = 0
    fetchSpy.mockImplementation(
      routeFetch({
        items: () => {
          callCount += 1
          if (callCount === 1) {
            return Promise.resolve(jsonResponse(200, { items: firstPage, count: 1, total: 3 }))
          }
          return Promise.resolve(jsonResponse(500, { detail: 'Internal error' }))
        },
      }),
    )
    const user = userEvent.setup()
    render(<ReceiptItems />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Show more' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not load items. Please try again.')
    })
    expect(screen.getByText('Item 0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
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

  test('money text is unchanged ("EUR 2.23")', async () => {
    const row = makeRow({ unit_price: 2.23, currency: 'EUR' })
    fetchSpy.mockImplementation(
      routeFetch({ items: () => Promise.resolve(jsonResponse(200, { items: [row], count: 1, total: 1 })) }),
    )

    render(<ReceiptItems />)

    await waitFor(() => {
      expect(screen.getByText('EUR 2.23')).toBeInTheDocument()
    })
  })

  test('the summary bar shows active filters and search, and Clear filters resets them', async () => {
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

    await waitFor(() => {
      expect(screen.getByText(`${WALDGLUECK.name} · 2026 · Approved · "milch"`)).toBeInTheDocument()
    })
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
    expect(screen.getByLabelText('Sort by')).toHaveValue('date_desc')
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
      expect(screen.getByLabelText('Sort by')).toBeInTheDocument()
    })

    await user.selectOptions(screen.getByLabelText('Sort by'), 'Amount (high to low)')

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
    expect(screen.getByLabelText('Sort by')).toHaveValue('date_desc')
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
    expect(screen.getByLabelText('Sort by')).toHaveValue('store')
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
      expect(screen.getByLabelText('Sort by')).toBeInTheDocument()
    })

    await user.selectOptions(screen.getByLabelText('Sort by'), 'Store (A-Z)')
    await waitFor(() => expect(window.location.search).toContain('sort=store'))

    // Simulate the browser's Back button: pop to the prior history entry and
    // dispatch the real popstate event ItemsHarness listens for.
    window.history.back()
    await waitFor(() => {
      expect(window.location.search).not.toContain('sort=')
    })
    await waitFor(() => {
      expect(screen.getByLabelText('Sort by')).toHaveValue('date_desc')
    })

    window.history.forward()
    await waitFor(() => {
      expect(window.location.search).toContain('sort=store')
    })
    await waitFor(() => {
      expect(screen.getByLabelText('Sort by')).toHaveValue('store')
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
