import { useEffect, useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReceiptHistory from './ReceiptHistory'

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

const THREE_ITEMS = [
  {
    receipt_id: '33333333-3333-3333-3333-333333333333',
    original_filename: 'c.jpg',
    store_name: 'Store C',
    purchase_date: '2026-01-17',
    currency: 'USD',
    total: 30,
    created_at: '2026-01-17T00:00:00+00:00',
  },
  {
    receipt_id: '22222222-2222-2222-2222-222222222222',
    original_filename: 'b.jpg',
    store_name: 'Store B',
    purchase_date: '2026-01-16',
    currency: 'USD',
    total: 20,
    created_at: '2026-01-16T00:00:00+00:00',
  },
  {
    receipt_id: '11111111-1111-1111-1111-111111111111',
    original_filename: 'a.jpg',
    store_name: 'Store A',
    purchase_date: '2026-01-15',
    currency: 'USD',
    total: 10,
    created_at: '2026-01-15T00:00:00+00:00',
  },
]

interface Routes {
  facets?: (urlString: string) => Promise<unknown>
  list?: (urlString: string) => Promise<unknown>
}

function routeFetch(routes: Routes = {}) {
  return (url: unknown) => {
    const urlString = String(url)
    if (urlString.includes('/receipts/facets')) {
      return routes.facets
        ? routes.facets(urlString)
        : Promise.resolve(jsonResponse(200, DEFAULT_FACETS))
    }
    if (urlString.includes('/receipts?')) {
      return routes.list
        ? routes.list(urlString)
        : Promise.reject(new Error(`Unexpected list call to ${urlString}`))
    }
    return Promise.reject(new Error(`Unexpected fetch call to ${urlString}`))
  }
}

/** Mirrors App.tsx's own key={locationKey}/popstate remount behavior, so
 * tests can exercise real tab/filter navigation (which fully remounts
 * ReceiptHistory in the real app) without rendering the whole App. */
function HistoryHarness() {
  const [key, setKey] = useState(() => window.location.search)
  useEffect(() => {
    const handlePopState = () => setKey(window.location.search)
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])
  return <ReceiptHistory key={key} />
}

describe('ReceiptHistory', () => {
  let fetchSpy: jest.Mock

  beforeEach(() => {
    fetchSpy = jest.fn().mockImplementation(routeFetch())
    global.fetch = fetchSpy as unknown as typeof fetch
  })

  afterEach(() => {
    // @ts-expect-error cleaning up the test-only global fetch stub
    delete global.fetch
  })

  test('three items are shown in the given (server) order', async () => {
    // Given the server returns three receipts, newest first
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: THREE_ITEMS, count: 3, total: 3 })) }),
    )

    // When the history view is rendered
    render(<ReceiptHistory />)

    // Then three rows are shown in the same order the server returned them
    await waitFor(() => {
      expect(screen.getByText('Store C')).toBeInTheDocument()
    })
    const rows = screen.getAllByRole('link', { name: /store/i })
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Store C')
    expect(rows[1]).toHaveTextContent('Store B')
    expect(rows[2]).toHaveTextContent('Store A')
  })

  test('empty list with no filters -> plain empty-state message shown', async () => {
    // Given the server has no saved receipts at all
    fetchSpy.mockImplementation(
      routeFetch({
        facets: () => Promise.resolve(jsonResponse(200, { apartments: [], total: 0, years: [], has_undated: false })),
        list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 })),
      }),
    )

    // When the history view is rendered
    render(<ReceiptHistory />)

    // Then the plain empty-state message is shown
    await waitFor(() => {
      expect(screen.getByText('No receipts yet. Upload your first receipt.')).toBeInTheDocument()
    })
  })

  test('item with null store, date and total -> "Not detected" shown, no null/undefined/NaN text', async () => {
    // Given a saved receipt with every nullable field null
    fetchSpy.mockImplementation(
      routeFetch({
        list: () =>
          Promise.resolve(
            jsonResponse(200, {
              items: [
                {
                  receipt_id: '11111111-1111-1111-1111-111111111111',
                  original_filename: null,
                  store_name: null,
                  purchase_date: null,
                  currency: null,
                  total: null,
                  created_at: '2026-01-15T00:00:00+00:00',
                },
              ],
              count: 1,
              total: 1,
            }),
          ),
      }),
    )

    // When the history view is rendered
    render(<ReceiptHistory />)

    // Then "Not detected" is shown for every missing field, with no raw null/undefined/NaN text
    await waitFor(() => {
      expect(screen.getAllByText('Not detected').length).toBeGreaterThan(0)
    })
    expect(document.body.textContent).not.toMatch(/\bnull\b/i)
    expect(document.body.textContent).not.toMatch(/\bundefined\b/i)
    expect(document.body.textContent).not.toMatch(/\bNaN\b/i)
  })

  test('loading state is shown while the request is pending', async () => {
    // Given the facets request has not resolved yet
    const deferred = createDeferred<unknown>()
    fetchSpy.mockImplementation(
      routeFetch({
        facets: () => deferred.promise,
        list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 })),
      }),
    )

    // When the history view is rendered
    render(<ReceiptHistory />)

    // Then "Loading receipts..." is shown inside a busy status region with
    // skeleton placeholder rows
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Loading receipts...')).toBeInTheDocument()
    expect(status.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0)

    // When the request resolves
    deferred.resolve(jsonResponse(200, { apartments: [], total: 0, years: [], has_undated: false }))

    // Then the status region and skeletons are gone and the real content is shown
    await waitFor(() =>
      expect(screen.getByText('No receipts yet. Upload your first receipt.')).toBeInTheDocument(),
    )
    expect(screen.queryByText('Loading receipts...')).not.toBeInTheDocument()
  })

  test('error response -> error shown, Retry calls everything again', async () => {
    // Given the facets endpoint returns an error on the first call only
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
        list: () => Promise.resolve(jsonResponse(200, { items: THREE_ITEMS, count: 3, total: 3 })),
      }),
    )
    const user = userEvent.setup()

    // When the history view is rendered
    render(<ReceiptHistory />)

    // Then an error message with a Retry button is shown
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Could not load receipt history. Please try again.',
      )
    })

    // When the user clicks Retry
    await user.click(screen.getByRole('button', { name: /retry/i }))

    // Then the data is requested again and shown
    await waitFor(() => {
      expect(screen.getByText('Store C')).toBeInTheDocument()
    })
    expect(callCount).toBe(2)
  })

  test('network failure -> error shown, Retry calls everything again', async () => {
    // Given the facets request fails outright on the first attempt
    let callCount = 0
    fetchSpy.mockImplementation(
      routeFetch({
        facets: () => {
          callCount += 1
          if (callCount === 1) {
            return Promise.reject(new TypeError('Failed to fetch'))
          }
          return Promise.resolve(jsonResponse(200, { apartments: [], total: 0, years: [], has_undated: false }))
        },
        list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 })),
      }),
    )
    const user = userEvent.setup()

    // When the history view is rendered
    render(<ReceiptHistory />)

    // Then a network error message is shown
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Could not reach the server. Please try again.',
      )
    })

    // When the user clicks Retry
    await user.click(screen.getByRole('button', { name: /retry/i }))

    // Then the data is requested again
    await waitFor(() => {
      expect(screen.getByText('No receipts yet. Upload your first receipt.')).toBeInTheDocument()
    })
    expect(callCount).toBe(2)
  })

  // --- Row badges --------------------------------------------------------

  test('in "All apartments", a row with an apartment shows it as a badge', async () => {
    fetchSpy.mockImplementation(
      routeFetch({
        list: () =>
          Promise.resolve(
            jsonResponse(200, {
              items: [
                {
                  receipt_id: '11111111-1111-1111-1111-111111111111',
                  original_filename: 'a.jpg',
                  store_name: 'Store A',
                  purchase_date: '2026-01-15',
                  currency: 'USD',
                  total: 10,
                  created_at: '2026-01-15T00:00:00+00:00',
                  apartment_id: OBERAUDORF.id,
                  apartment_name: OBERAUDORF.name,
                },
              ],
              count: 1,
              total: 1,
            }),
          ),
      }),
    )

    render(<ReceiptHistory />)

    // The badge shows the short name visibly, with the full name as its
    // title tooltip and as hidden text for assistive tech -- scoped to the
    // row list, since the apartment tab also carries this same title.
    await waitFor(() => {
      expect(within(screen.getByRole('list')).getByTitle(OBERAUDORF.name)).toBeInTheDocument()
    })
    expect(within(screen.getByRole('list')).getAllByText(OBERAUDORF.name).length).toBeGreaterThan(0)
  })

  test('a row with no apartment shows plain muted "Not assigned", and a missing field renders without crashing', async () => {
    fetchSpy.mockImplementation(
      routeFetch({
        list: () =>
          Promise.resolve(
            jsonResponse(200, {
              items: [
                {
                  receipt_id: '11111111-1111-1111-1111-111111111111',
                  original_filename: 'a.jpg',
                  store_name: 'Store A',
                  purchase_date: '2026-01-15',
                  currency: 'USD',
                  total: 10,
                  created_at: '2026-01-15T00:00:00+00:00',
                  apartment_id: null,
                  apartment_name: null,
                },
                {
                  receipt_id: '22222222-2222-2222-2222-222222222222',
                  original_filename: 'b.jpg',
                  store_name: 'Store B',
                  purchase_date: '2026-01-16',
                  currency: 'USD',
                  total: 20,
                  created_at: '2026-01-16T00:00:00+00:00',
                },
              ],
              count: 2,
              total: 2,
            }),
          ),
      }),
    )

    render(<ReceiptHistory />)

    await waitFor(() => {
      expect(screen.getAllByText('Not assigned')).toHaveLength(2)
    })
  })

  test('under the "All" status filter, both approved and needs_review rows show their status badge', async () => {
    // Given one approved and one needs_review receipt
    fetchSpy.mockImplementation(
      routeFetch({
        list: () =>
          Promise.resolve(
            jsonResponse(200, {
              items: [
                {
                  receipt_id: '11111111-1111-1111-1111-111111111111',
                  original_filename: 'a.jpg',
                  store_name: 'Store A',
                  purchase_date: '2026-01-15',
                  currency: 'USD',
                  total: 10,
                  created_at: '2026-01-15T00:00:00+00:00',
                  status: 'approved',
                },
                {
                  receipt_id: '22222222-2222-2222-2222-222222222222',
                  original_filename: 'b.jpg',
                  store_name: 'Store B',
                  purchase_date: '2026-01-16',
                  currency: 'USD',
                  total: 20,
                  created_at: '2026-01-16T00:00:00+00:00',
                  status: 'needs_review',
                },
              ],
              count: 2,
              total: 2,
            }),
          ),
      }),
    )

    // When the history renders with no status filter
    render(<ReceiptHistory />)

    // Then each row shows its own badge
    await waitFor(() => {
      expect(within(screen.getByRole('link', { name: /store b/i })).getByText('Needs review')).toBeInTheDocument()
    })
    expect(within(screen.getByRole('link', { name: /store a/i })).getByText('Approved')).toBeInTheDocument()
  })

  // --- Tabs ----------------------------------------------------------------

  test('tabs render with counts from the facets', async () => {
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 })) }),
    )
    render(<ReceiptHistory />)

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'All apartments (3)' })).toBeInTheDocument()
    })
    // Each apartment tab's accessible name is the full name (no count);
    // the count is still visible in the tab's own text content.
    expect(screen.getByRole('tab', { name: OBERAUDORF.name })).toHaveTextContent(`${OBERAUDORF.name} (2)`)
    expect(screen.getByRole('tab', { name: WALDGLUECK.name })).toHaveTextContent(`${WALDGLUECK.name} (1)`)
    expect(screen.getByRole('tab', { name: 'All apartments (3)' })).toHaveAttribute('aria-selected', 'true')
  })

  test('each apartment tab shows the full name as its title tooltip', async () => {
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 })) }),
    )
    render(<ReceiptHistory />)

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: OBERAUDORF.name })).toHaveAttribute('title', OBERAUDORF.name)
    })
  })

  test('choosing a tab sends apartment_id and updates the URL', async () => {
    const user = userEvent.setup()
    fetchSpy.mockImplementation(
      routeFetch({
        facets: (urlString) => {
          if (urlString.includes(`apartment_id=${OBERAUDORF.id}`)) {
            return Promise.resolve(jsonResponse(200, { ...DEFAULT_FACETS, years: [2026], has_undated: false }))
          }
          return Promise.resolve(jsonResponse(200, DEFAULT_FACETS))
        },
        list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 })),
      }),
    )
    render(<HistoryHarness />)
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: OBERAUDORF.name })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('tab', { name: OBERAUDORF.name }))

    await waitFor(() => {
      expect(window.location.search).toContain(`apartment=${OBERAUDORF.id}`)
    })
    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some(([url]) => String(url).includes(`/receipts?`) && String(url).includes(`apartment_id=${OBERAUDORF.id}`)),
      ).toBe(true)
    })
  })

  test('arrow keys move the tab selection', async () => {
    const user = userEvent.setup()
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 })) }),
    )
    render(<HistoryHarness />)
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'All apartments (3)' })).toBeInTheDocument()
    })

    screen.getByRole('tab', { name: 'All apartments (3)' }).focus()
    await user.keyboard('{ArrowRight}')

    await waitFor(() => {
      expect(window.location.search).toContain(`apartment=${OBERAUDORF.id}`)
    })
    // Focus follows the selection across the remount a navigation causes.
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: OBERAUDORF.name })).toHaveFocus()
    })

    await user.keyboard('{ArrowRight}')
    await waitFor(() => {
      expect(window.location.search).toContain(`apartment=${WALDGLUECK.id}`)
    })
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: WALDGLUECK.name })).toHaveFocus()
    })

    await user.keyboard('{Home}')
    await waitFor(() => {
      expect(window.location.search).not.toContain('apartment=')
    })
  })

  test('apartment badge is hidden in a specific apartment tab, shown in All apartments', async () => {
    const item = {
      receipt_id: '11111111-1111-1111-1111-111111111111',
      original_filename: 'a.jpg',
      store_name: 'Store A',
      purchase_date: '2026-01-15',
      currency: 'USD',
      total: 10,
      created_at: '2026-01-15T00:00:00+00:00',
      apartment_id: OBERAUDORF.id,
      apartment_name: OBERAUDORF.name,
    }

    // All apartments -- badge shown
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [item], count: 1, total: 1 })) }),
    )
    const { unmount } = render(<ReceiptHistory />)
    await waitFor(() => {
      expect(within(screen.getByRole('list')).getByTitle(OBERAUDORF.name)).toBeInTheDocument()
    })
    unmount()

    // A specific apartment tab -- badge hidden (redundant); the tab button
    // itself still carries this same title, so the check is scoped to the
    // row list, not the whole document.
    window.history.replaceState({}, '', `/?view=history&apartment=${OBERAUDORF.id}`)
    render(<ReceiptHistory />)
    await waitFor(() => {
      expect(screen.getByText('Store A')).toBeInTheDocument()
    })
    expect(within(screen.getByRole('list')).queryByTitle(OBERAUDORF.name)).not.toBeInTheDocument()
  })

  // --- Filters ---------------------------------------------------------------

  test('each select sends its own param', async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        list: (urlString) => {
          calls.push(urlString)
          return Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 }))
        },
      }),
    )
    render(<HistoryHarness />)
    await waitFor(() => {
      expect(screen.getByLabelText('Year')).toBeInTheDocument()
    })

    await user.selectOptions(screen.getByLabelText('Year'), '2026')
    await waitFor(() => expect(window.location.search).toContain('year=2026'))

    await user.selectOptions(screen.getByLabelText('Status'), 'Approved')
    await waitFor(() => expect(window.location.search).toContain('status=approved'))

    const lastCall = calls[calls.length - 1]
    expect(lastCall).toContain('year=2026')
    expect(lastCall).toContain('status=approved')
  })

  test('"No valid date" option only appears when has_undated is true', async () => {
    fetchSpy.mockImplementation(
      routeFetch({
        facets: () => Promise.resolve(jsonResponse(200, { ...DEFAULT_FACETS, has_undated: false })),
        list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 })),
      }),
    )
    const { unmount } = render(<ReceiptHistory />)
    await waitFor(() => {
      expect(screen.getByLabelText('Year')).toBeInTheDocument()
    })
    expect(screen.queryByText('No valid date')).not.toBeInTheDocument()
    unmount()

    fetchSpy.mockImplementation(
      routeFetch({
        facets: () => Promise.resolve(jsonResponse(200, { ...DEFAULT_FACETS, has_undated: true })),
        list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 })),
      }),
    )
    render(<ReceiptHistory />)
    await waitFor(() => {
      expect(screen.getByText('No valid date')).toBeInTheDocument()
    })
  })

  test('a URL with filters loads the filtered list on first render', async () => {
    window.history.replaceState({}, '', `/?view=history&apartment=${OBERAUDORF.id}&year=2025&status=approved`)
    let capturedUrl = ''
    fetchSpy.mockImplementation(
      routeFetch({
        list: (urlString) => {
          capturedUrl = urlString
          return Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 }))
        },
      }),
    )

    render(<ReceiptHistory />)

    await waitFor(() => {
      expect(capturedUrl).toContain(`apartment_id=${OBERAUDORF.id}`)
    })
    expect(capturedUrl).toContain('year=2025')
    expect(capturedUrl).toContain('status=approved')
    expect(screen.getByRole('tab', { name: OBERAUDORF.name })).toHaveAttribute('aria-selected', 'true')
  })

  test('invalid URL values are ignored, showing the unfiltered result for that value', async () => {
    window.history.replaceState({}, '', '/?view=history&apartment=does-not-exist&year=25&status=archived')
    let capturedUrl = ''
    fetchSpy.mockImplementation(
      routeFetch({
        list: (urlString) => {
          capturedUrl = urlString
          return Promise.resolve(jsonResponse(200, { items: THREE_ITEMS, count: 3, total: 3 }))
        },
      }),
    )

    render(<ReceiptHistory />)

    await waitFor(() => {
      expect(screen.getByText('Store C')).toBeInTheDocument()
    })
    expect(capturedUrl).not.toContain('apartment_id=')
    expect(capturedUrl).not.toContain('year=')
    expect(capturedUrl).not.toContain('status=')
    expect(screen.getByRole('tab', { name: 'All apartments (3)' })).toHaveAttribute('aria-selected', 'true')
  })

  test('an old URL containing &category=... is ignored without error, loading normally', async () => {
    window.history.replaceState({}, '', `/?view=history&apartment=${OBERAUDORF.id}&year=2026&status=needs_review&category=cleaning`)
    let capturedUrl = ''
    fetchSpy.mockImplementation(
      routeFetch({
        list: (urlString) => {
          capturedUrl = urlString
          return Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 }))
        },
      }),
    )

    render(<ReceiptHistory />)

    await waitFor(() => {
      expect(capturedUrl).toContain(`apartment_id=${OBERAUDORF.id}`)
    })
    expect(capturedUrl).toContain('year=2026')
    expect(capturedUrl).toContain('status=needs_review')
    expect(capturedUrl).not.toContain('category')
  })

  test('"Clear filters" appears when a select is active and keeps the apartment tab', async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, '', `/?view=history&apartment=${OBERAUDORF.id}&year=2026`)
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 })) }),
    )
    render(<HistoryHarness />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    await waitFor(() => {
      expect(window.location.search).toContain(`apartment=${OBERAUDORF.id}`)
    })
    expect(window.location.search).not.toContain('year=')
  })

  test('no "Clear filters" button when only the apartment tab is selected', async () => {
    window.history.replaceState({}, '', `/?view=history&apartment=${OBERAUDORF.id}`)
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 })) }),
    )
    render(<ReceiptHistory />)
    await waitFor(() => {
      expect(screen.getByText('0 receipts')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
  })

  test('a filtered empty result shows "No receipts match these filters.", not the plain empty state', async () => {
    window.history.replaceState({}, '', '/?view=history&status=approved')
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 })) }),
    )

    render(<ReceiptHistory />)

    await waitFor(() => {
      expect(screen.getByText('No receipts match these filters.')).toBeInTheDocument()
    })
    expect(screen.queryByText('No receipts yet. Upload your first receipt.')).not.toBeInTheDocument()
  })

  test('Back restores the previous tab and filters', async () => {
    const user = userEvent.setup()
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 })) }),
    )
    render(<HistoryHarness />)
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: OBERAUDORF.name })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('tab', { name: OBERAUDORF.name }))
    await waitFor(() => {
      expect(window.location.search).toContain(`apartment=${OBERAUDORF.id}`)
    })

    window.history.back()

    await waitFor(() => {
      expect(window.location.search).not.toContain('apartment=')
    })
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'All apartments (3)' })).toHaveAttribute('aria-selected', 'true')
    })
  })

  test('the "N receipts" count is shown as a status', async () => {
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: THREE_ITEMS, count: 3, total: 3 })) }),
    )
    render(<ReceiptHistory />)
    await waitFor(() => {
      expect(screen.getByText('3 receipts')).toBeInTheDocument()
    })
    expect(screen.getByText('3 receipts')).toHaveAttribute('role', 'status')
  })

  // --- Compact rows: dates, badges, links, short names --------------------

  function oneItem(overrides: Record<string, unknown> = {}) {
    return {
      receipt_id: '11111111-1111-1111-1111-111111111111',
      original_filename: 'a.jpg',
      store_name: 'Store A',
      purchase_date: '2026-01-15',
      currency: 'USD',
      total: 10,
      created_at: '2026-01-15T00:00:00+00:00',
      ...overrides,
    }
  }

  // --- Column header row (from sm up) ------------------------------------

  function headerRow(): HTMLElement | null {
    return document.querySelector('[aria-hidden="true"].border-b')
  }

  test('from sm up, "All apartments" + Status "All" shows a hidden-from-AT header row with every column', async () => {
    // Given the unfiltered history with one receipt
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [oneItem()], count: 1, total: 1 })) }),
    )

    // When it renders (jsdom has no matchMedia: the wide layout)
    render(<ReceiptHistory />)
    await waitFor(() => {
      expect(screen.getByText('Store A')).toBeInTheDocument()
    })

    // Then the header row labels every column, inside the same card as the rows, and is hidden from assistive tech
    const header = headerRow()
    expect(header).not.toBeNull()
    expect(Array.from(header!.children).map((c) => c.textContent)).toEqual([
      'Store',
      'Date',
      'Total',
      'Apartment',
      'Status',
    ])
    expect(header!.children[2]).toHaveClass('text-right')
    expect(header!.parentElement).toBe(screen.getByRole('list').parentElement)
  })

  test('the Apartment column header is left out inside one apartment tab', async () => {
    // Given an apartment tab
    window.history.replaceState({}, '', `/?view=history&apartment=${OBERAUDORF.id}`)
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [oneItem()], count: 1, total: 1 })) }),
    )
    render(<ReceiptHistory />)
    await waitFor(() => {
      expect(screen.getByText('Store A')).toBeInTheDocument()
    })

    // Then the header has no Apartment label, but still a Status one
    expect(Array.from(headerRow()!.children).map((c) => c.textContent)).toEqual(['Store', 'Date', 'Total', 'Status'])
  })

  test('under a specific Status filter there is no Status column header and no badge', async () => {
    // Given Status "Approved"
    window.history.replaceState({}, '', '/?view=history&status=approved')
    fetchSpy.mockImplementation(
      routeFetch({
        list: () => Promise.resolve(jsonResponse(200, { items: [oneItem({ status: 'approved' })], count: 1, total: 1 })),
      }),
    )
    render(<ReceiptHistory />)
    await waitFor(() => {
      expect(screen.getByText('Store A')).toBeInTheDocument()
    })

    // Then the header has no Status label, and the row no "Approved" badge
    expect(Array.from(headerRow()!.children).map((c) => c.textContent)).toEqual([
      'Store',
      'Date',
      'Total',
      'Apartment',
    ])
    expect(within(screen.getByRole('list')).queryByText('Approved')).not.toBeInTheDocument()
  })

  test('below sm there is no header row', async () => {
    // Given a small screen
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 639px)',
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    })) as unknown as typeof window.matchMedia
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [oneItem()], count: 1, total: 1 })) }),
    )
    render(<ReceiptHistory />)
    await waitFor(() => {
      expect(screen.getByText('Store A')).toBeInTheDocument()
    })

    // Then only the rows are shown
    expect(headerRow()).toBeNull()
    // @ts-expect-error removing the test-only matchMedia stub
    delete window.matchMedia
  })

  test('a valid ISO purchase_date renders as DD.MM.YYYY via formatDisplayDate', async () => {
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [oneItem()], count: 1, total: 1 })) }),
    )
    render(<ReceiptHistory />)

    await waitFor(() => {
      expect(screen.getByText('15.01.2026')).toBeInTheDocument()
    })
  })

  test('a non-date raw date shows the raw text with the Items view\'s warning marker', async () => {
    fetchSpy.mockImplementation(
      routeFetch({
        list: () =>
          Promise.resolve(jsonResponse(200, { items: [oneItem({ purchase_date: '02 Juni 2026' })], count: 1 , total: 1 })),
      }),
    )
    render(<ReceiptHistory />)

    await waitFor(() => {
      expect(screen.getByText('02 Juni 2026')).toBeInTheDocument()
    })
    expect(screen.getByText('Date not recognized')).toBeInTheDocument()
  })

  test('a missing purchase_date renders MissingValue, not raw "Not detected" text', async () => {
    fetchSpy.mockImplementation(
      routeFetch({
        list: () => Promise.resolve(jsonResponse(200, { items: [oneItem({ purchase_date: null })], count: 1 , total: 1 })),
      }),
    )
    render(<ReceiptHistory />)

    await waitFor(() => {
      expect(screen.getByText('Store A')).toBeInTheDocument()
    })
    // MissingValue's hidden text, findable the same way the old plain text was
    expect(screen.getAllByText('Not detected').length).toBeGreaterThan(0)
  })

  test('the status badge is shown only when the Status filter is "All"', async () => {
    // Given a needs_review receipt and no status filter: its badge shows
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [oneItem({ status: 'needs_review' })], count: 1 , total: 1 })) }),
    )
    const { unmount } = render(<ReceiptHistory />)
    await waitFor(() => {
      expect(within(screen.getByRole('list')).getByText('Needs review')).toBeInTheDocument()
    })
    unmount()

    // When the Status filter is "Needs review"
    window.history.replaceState({}, '', '/?view=history&status=needs_review')
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [oneItem({ status: 'needs_review' })], count: 1 , total: 1 })) }),
    )
    render(<ReceiptHistory />)
    await waitFor(() => {
      expect(screen.getByText('Store A')).toBeInTheDocument()
    })
    // Then the row shows no badge (redundant with the filter)
    expect(within(screen.getByRole('list')).queryByText('Needs review')).not.toBeInTheDocument()
  })

  test('an apartment tab with a three-segment name shows the short name and count, full name as the accessible name and title', async () => {
    const threeSegment = { id: 'oberaudorf-bergblick', name: 'Fewo JoJo - Oberaudorf - Bergblick', count: 5 }
    fetchSpy.mockImplementation(
      routeFetch({
        facets: () =>
          Promise.resolve(
            jsonResponse(200, { apartments: [threeSegment], total: 5, years: [2026], has_undated: false }),
          ),
        list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 })),
      }),
    )
    render(<ReceiptHistory />)

    const tab = await screen.findByRole('tab', { name: threeSegment.name })
    expect(tab).toHaveTextContent('Bergblick (5)')
    expect(tab).toHaveAttribute('title', threeSegment.name)
  })

  test('row hrefs point at the receipt and carry `from` when a tab/filter is active', async () => {
    window.history.replaceState({}, '', `/?view=history&apartment=${OBERAUDORF.id}`)
    fetchSpy.mockImplementation(
      routeFetch({
        facets: (urlString) =>
          Promise.resolve(
            jsonResponse(
              200,
              urlString.includes(`apartment_id=${OBERAUDORF.id}`)
                ? { ...DEFAULT_FACETS, years: [2026], has_undated: false }
                : DEFAULT_FACETS,
            ),
          ),
        list: () => Promise.resolve(jsonResponse(200, { items: [oneItem()], count: 1, total: 1 })),
      }),
    )
    render(<ReceiptHistory />)

    const link = await screen.findByRole('link', { name: /store a/i })
    expect(link).toHaveAttribute(
      'href',
      `/?receipt=11111111-1111-1111-1111-111111111111&from=${encodeURIComponent(`?view=history&apartment=${OBERAUDORF.id}`)}`,
    )
  })

  test('row hrefs have no `from` when unfiltered', async () => {
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [oneItem()], count: 1, total: 1 })) }),
    )
    render(<ReceiptHistory />)

    const link = await screen.findByRole('link', { name: /store a/i })
    expect(link).toHaveAttribute('href', '/?receipt=11111111-1111-1111-1111-111111111111')
  })

  test('a long store name is clamped with the full text in its title', async () => {
    const longName = 'A'.repeat(140)
    fetchSpy.mockImplementation(
      routeFetch({
        list: () => Promise.resolve(jsonResponse(200, { items: [oneItem({ store_name: longName })], count: 1 , total: 1 })),
      }),
    )
    render(<ReceiptHistory />)

    await waitFor(() => {
      expect(screen.getByTitle(longName)).toBeInTheDocument()
    })
  })

  // --- Filter row composition (Commit 2) ----------------------------------

  test('Year and Status selects are composed in the same row container', async () => {
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 })) }),
    )
    render(<ReceiptHistory />)

    await waitFor(() => {
      expect(screen.getByLabelText('Year')).toBeInTheDocument()
    })
    const yearSelect = screen.getByLabelText('Year')
    const statusSelect = screen.getByLabelText('Status')
    // Both selects' wrapping row container is the same element, and that
    // row is composed with the md:flex-row layout (never sm:flex-row,
    // which the Items view's own, differently-composed row never used
    // either -- this is the one row ReceiptHistory and ReceiptItems now
    // share the same breakpoint for).
    const yearRow = yearSelect.closest('div')?.parentElement
    const statusRow = statusSelect.closest('div')?.parentElement
    expect(yearRow).toBe(statusRow)
    expect(yearRow?.className).toContain('md:flex-row')
  })

  // --- "Show more" paging (Commit 2) --------------------------------------

  test('the summary shows "N receipts" when everything is loaded', async () => {
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: THREE_ITEMS, count: 3, total: 3 })) }),
    )
    render(<ReceiptHistory />)

    await waitFor(() => {
      expect(screen.getByText('3 receipts')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
  })

  test('the summary shows "X of N receipts" while more remain, and "Show more" appends and disappears at the end', async () => {
    const firstPage = [oneItem({ receipt_id: 'p1-0', store_name: 'Page 1 Item 0' })]
    const secondPage = [oneItem({ receipt_id: 'p2-0', store_name: 'Page 2 Item 0' })]
    let callCount = 0
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        list: (urlString) => {
          calls.push(urlString)
          callCount += 1
          if (callCount === 1) {
            return Promise.resolve(jsonResponse(200, { items: firstPage, count: 1, total: 2 }))
          }
          return Promise.resolve(jsonResponse(200, { items: secondPage, count: 1, total: 2 }))
        },
      }),
    )
    const user = userEvent.setup()
    render(<ReceiptHistory />)

    await waitFor(() => {
      expect(screen.getByText('1 of 2 receipts')).toBeInTheDocument()
    })
    expect(screen.getByText('Page 1 Item 0')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show more' }))

    await waitFor(() => {
      expect(screen.getByText('2 receipts')).toBeInTheDocument()
    })
    // The first page's row is still shown -- appended, not replaced
    expect(screen.getByText('Page 1 Item 0')).toBeInTheDocument()
    expect(screen.getByText('Page 2 Item 0')).toBeInTheDocument()
    expect(calls[1]).toContain('offset=1')
    // Nothing left to show -- the button is gone
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
  })

  test('a failed "Show more" keeps the rows shown and shows an error with Retry', async () => {
    const firstPage = [oneItem({ store_name: 'Page 1 Item' })]
    let callCount = 0
    fetchSpy.mockImplementation(
      routeFetch({
        list: () => {
          callCount += 1
          if (callCount === 1) {
            return Promise.resolve(jsonResponse(200, { items: firstPage, count: 1, total: 3 }))
          }
          return Promise.resolve(jsonResponse(500, { detail: 'Internal error' }))
        },
      }),
    )
    const user = userEvent.setup()
    render(<ReceiptHistory />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Show more' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not load receipt history. Please try again.')
    })
    expect(screen.getByText('Page 1 Item')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()

    // Retry re-sends the request; a success clears the error and the row stays
    fetchSpy.mockImplementation(
      routeFetch({
        list: () =>
          Promise.resolve(
            jsonResponse(200, {
              items: [oneItem({ receipt_id: 'page-2', store_name: 'Page 2 Item' })],
              count: 1,
              total: 3,
            }),
          ),
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => {
      expect(screen.getByText('Page 2 Item')).toBeInTheDocument()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('changing a filter resets paging to the first page (offset=0)', async () => {
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        list: (urlString) => {
          calls.push(urlString)
          return Promise.resolve(jsonResponse(200, { items: [oneItem()], count: 1, total: 5 }))
        },
      }),
    )
    const user = userEvent.setup()
    render(<HistoryHarness />)
    await waitFor(() => {
      expect(screen.getByText('Show more')).toBeInTheDocument()
    })

    await user.selectOptions(screen.getByLabelText('Status'), 'Approved')

    await waitFor(() => expect(window.location.search).toContain('status=approved'))
    const lastCall = calls[calls.length - 1]
    expect(lastCall).toContain('offset=0')
  })

  test('a reply to an older (stale) request never overwrites the newer result', async () => {
    const olderItem = oneItem({ receipt_id: 'stale-id', store_name: 'Stale Item' })
    const newerItem = oneItem({ receipt_id: 'fresh-id', store_name: 'Fresh Item' })
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
        list: (urlString) =>
          Promise.resolve(
            jsonResponse(
              200,
              urlString.includes('status=approved')
                ? { items: [olderItem], count: 1, total: 1 }
                : { items: [newerItem], count: 1, total: 1 },
            ),
          ),
      }),
    )

    // Given the older (stale) request starts first, for a URL with a filter
    window.history.replaceState({}, '', '/?view=history&status=approved')
    const { unmount } = render(<ReceiptHistory />)

    // When a newer request starts (remount, as a real navigation would do)
    // before the older one has resolved
    unmount()
    window.history.replaceState({}, '', '/?view=history')
    render(<ReceiptHistory />)

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
})
