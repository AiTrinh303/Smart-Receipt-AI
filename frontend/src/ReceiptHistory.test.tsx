import { useEffect, useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReceiptHistory from './ReceiptHistory'
import { expectBrowserHandlesModifiedClicks } from './test/linkClicks'
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
      expect(selectControl('Year')).toBeInTheDocument()
    })

    await chooseOption(user, 'Year', '2026')
    await waitFor(() => expect(window.location.search).toContain('year=2026'))

    await chooseOption(user, 'Status', 'Approved')
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
      expect(selectControl('Year')).toBeInTheDocument()
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

  test('apartment labels and apartment tabs use the apartment\'s colour, with the name still as text', async () => {
    // Given a receipt in each known apartment
    fetchSpy.mockImplementation(
      routeFetch({
        list: () =>
          Promise.resolve(
            jsonResponse(200, {
              items: [
                oneItem({ apartment_id: OBERAUDORF.id, apartment_name: OBERAUDORF.name }),
                oneItem({
                  receipt_id: '22222222-2222-2222-2222-222222222222',
                  store_name: 'Store B',
                  apartment_id: WALDGLUECK.id,
                  apartment_name: WALDGLUECK.name,
                }),
              ],
              count: 2,
              total: 2,
            }),
          ),
      }),
    )
    render(<ReceiptHistory />)
    await waitFor(() => {
      expect(screen.getByText('Store B')).toBeInTheDocument()
    })

    // Then each row's label is a pill in its apartment's tone, titled with the full name
    const list = screen.getByRole('list')
    expect(within(list).getByTitle(OBERAUDORF.name)).toHaveClass('bg-apartment-sky-soft', 'text-apartment-sky')
    expect(within(list).getByTitle(WALDGLUECK.name)).toHaveClass('bg-apartment-fuchsia-soft', 'text-apartment-fuchsia')
    // And each apartment tab carries a decorative dot in that tone, the "All" tab none
    const bergblickTab = screen.getByRole('tab', { name: OBERAUDORF.name })
    expect(bergblickTab.querySelector('[aria-hidden="true"].bg-apartment-sky')).not.toBeNull()
    expect(screen.getByRole('tab', { name: /all apartments/i }).querySelector('[aria-hidden="true"]')).toBeNull()
  })

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
    // Status is right-aligned too, and Apartment is set apart from Total
    expect(header!.children[4]).toHaveClass('text-right')
    expect(header!.children[3]).toHaveClass('ml-4')
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

  test('a row leaves ctrl/cmd-click to the browser; a plain click still opens the receipt in place', async () => {
    // Given the unfiltered list with one receipt
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [oneItem()], count: 1, total: 1 })) }),
    )
    render(<ReceiptHistory />)
    const link = await screen.findByRole('link', { name: /store a/i })

    // Then modified clicks are not prevented (new tab via the href), and a plain click navigates
    expectBrowserHandlesModifiedClicks(link, '?receipt=11111111-1111-1111-1111-111111111111')
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

  test('Year, Status, File type and Sort by fill one row: four equal columns from lg, 2x2 from md, stacked below', async () => {
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0, total: 0 })) }),
    )
    render(<ReceiptHistory />)

    await waitFor(() => {
      expect(selectControl('Year')).toBeInTheDocument()
    })
    // Then the four controls sit in one grid, in this order, filling the row like the list card
    const row = selectControl('Year').closest('.grid') as HTMLElement
    expect(row).toHaveClass('grid', 'grid-cols-1', 'md:grid-cols-2', 'lg:grid-cols-4')
    expect(row.children).toHaveLength(4)
    const order = ['Year', 'Status', 'File type', 'Sort by'].map((label) => selectControl(label))
    order.forEach((control, index) => expect(row.children[index]).toContainElement(control))
  })

  // --- File type ------------------------------------------------------------

  function fileTypeParam(url: string): string | null {
    return new URL(url, 'http://x').searchParams.get('file_type')
  }

  test('File type: "All types", PDF, JPG, PNG; without &type= no file_type is sent and the control is not active', async () => {
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        list: (url) => {
          calls.push(url)
          return Promise.resolve(jsonResponse(200, { items: [oneItem()], count: 1, total: 1 }))
        },
      }),
    )
    render(<ReceiptHistory />)
    await waitFor(() => expect(calls).toHaveLength(1))

    // Then the options are exactly these, "All types" is chosen and nothing is sent
    const control = await waitFor(() => selectControl('File type'))
    expect(optionLabels(control)).toEqual(['All types', 'PDF', 'JPG', 'PNG'])
    expect(selectValue(control)).toBe('')
    expect(control).not.toHaveClass('bg-brand-soft')
    expect(fileTypeParam(calls[0])).toBeNull()
  })

  test('&type=pdf in the URL is sent as file_type=pdf; the control shows PDF in the active style; Clear filters appears', async () => {
    window.history.replaceState({}, '', '/?view=history&type=pdf')
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        list: (url) => {
          calls.push(url)
          return Promise.resolve(jsonResponse(200, { items: [oneItem()], count: 1, total: 1 }))
        },
      }),
    )
    render(<ReceiptHistory />)
    await waitFor(() => expect(calls).toHaveLength(1))

    // Then the request filters by PDF and the control is active with its value as text
    expect(fileTypeParam(calls[0])).toBe('pdf')
    const control = await waitFor(() => selectControl('File type'))
    expect(selectValue(control)).toBe('pdf')
    expect(control).toHaveTextContent('PDF')
    expect(control).toHaveClass('border-brand', 'bg-brand-soft')
    // And the file type alone counts as an active filter
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
  })

  test('an invalid &type= is ignored: no file_type is sent and the control shows All types', async () => {
    window.history.replaceState({}, '', '/?view=history&type=gif')
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        list: (url) => {
          calls.push(url)
          return Promise.resolve(jsonResponse(200, { items: [oneItem()], count: 1, total: 1 }))
        },
      }),
    )
    render(<ReceiptHistory />)
    await waitFor(() => expect(calls).toHaveLength(1))

    expect(fileTypeParam(calls[0])).toBeNull()
    expect(selectValue(await waitFor(() => selectControl('File type')))).toBe('')
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
  })

  test('choosing a file type writes &type=, resets to page 1 and refetches; "All types" drops it again', async () => {
    // Given page 2 of a filtered, sorted list
    window.history.replaceState({}, '', '/?view=history&year=2026&sort=amount_desc&page=2')
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        list: (url) => {
          calls.push(url)
          return Promise.resolve(jsonResponse(200, { items: [oneItem()], count: 1, total: 30 }))
        },
      }),
    )
    const user = userEvent.setup()
    render(<HistoryHarness />)
    await waitFor(() => expect(selectControl('File type')).toBeInTheDocument())

    // When JPG is chosen
    await chooseOption(user, 'File type', 'JPG')

    // Then the URL has type=jpg, keeps year and sort, drops the page, and the request asks for jpg from offset 0
    await waitFor(() => expect(window.location.search).toBe('?view=history&year=2026&type=jpg&sort=amount_desc'))
    await waitFor(() => expect(fileTypeParam(calls[calls.length - 1])).toBe('jpg'))
    expect(new URL(calls[calls.length - 1], 'http://x').searchParams.get('offset')).toBe('0')
    expect(new URL(calls[calls.length - 1], 'http://x').searchParams.get('year')).toBe('2026')

    // When "All types" is chosen
    await waitFor(() => expect(selectValue(selectControl('File type'))).toBe('jpg'))
    await chooseOption(user, 'File type', 'All types')

    // Then type is gone from the URL and the request
    await waitFor(() => expect(window.location.search).toBe('?view=history&year=2026&sort=amount_desc'))
    await waitFor(() => expect(fileTypeParam(calls[calls.length - 1])).toBeNull())
  })

  test('Clear filters clears the file type too, keeping the apartment tab and the sort', async () => {
    window.history.replaceState({}, '', `/?view=history&apartment=${OBERAUDORF.id}&year=2026&type=png&sort=amount_desc`)
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [oneItem()], count: 1, total: 1 })) }),
    )
    const user = userEvent.setup()
    render(<HistoryHarness />)

    await user.click(await screen.findByRole('button', { name: 'Clear filters' }))

    await waitFor(() =>
      expect(window.location.search).toBe(`?view=history&apartment=${OBERAUDORF.id}&sort=amount_desc`),
    )
  })

  test('a receipt opened from a file-type-filtered list carries the type in its from= link (for review mode)', async () => {
    window.history.replaceState({}, '', '/?view=history&type=pdf')
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [oneItem()], count: 1, total: 1 })) }),
    )
    render(<ReceiptHistory />)

    const link = await screen.findByRole('link', { name: /store a/i })
    expect(link).toHaveAttribute('href', expect.stringContaining(`&from=${encodeURIComponent('?view=history&type=pdf')}`))
  })

  // --- Sort by ------------------------------------------------------------

  function sortParam(url: string): string | null {
    return new URL(url, 'http://x').searchParams.get('sort')
  }

  test('"Sort by" defaults to "Date (newest first)", sends date_desc, and leaves sort out of the URL', async () => {
    // Given the plain history view
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        list: (urlString) => {
          calls.push(urlString)
          return Promise.resolve(jsonResponse(200, { items: [oneItem()], count: 1, total: 1 }))
        },
      }),
    )
    render(<ReceiptHistory />)
    await screen.findByText('Store A')

    // Then the select shows the default and its five options, in order
    const select = selectControl('Sort by')
    expect(selectValue(select)).toBe('date_desc')
    expect(optionLabels(select)).toEqual([
      'Date (newest first)',
      'Date (oldest first)',
      'Total (high to low)',
      'Total (low to high)',
      'Recently uploaded',
    ])
    // And the request still sends the sort explicitly, while the URL has none
    expect(sortParam(calls[0])).toBe('date_desc')
    expect(window.location.search).not.toContain('sort=')
  })

  test('choosing a sort writes &sort= to the URL, remounts, and sends it (also on page 2); back to the default drops it', async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        list: (urlString) => {
          calls.push(urlString)
          return Promise.resolve(jsonResponse(200, { items: [oneItem()], count: 1, total: 30 }))
        },
      }),
    )
    render(<HistoryHarness />)
    await screen.findByRole('combobox', { name: 'Sort by' })

    // When "Total (high to low)" is chosen
    await chooseOption(user, 'Sort by', 'Total (high to low)')

    // Then the URL carries it and the new list request sends it
    await waitFor(() => expect(window.location.search).toContain('sort=amount_desc'))
    await waitFor(() => expect(sortParam(calls[calls.length - 1])).toBe('amount_desc'))
    expect(selectValue(selectControl('Sort by'))).toBe('amount_desc')

    // And another page continues with the same sort (and the sort stays in the page links)
    const page2 = await screen.findByRole('link', { name: 'Page 2' })
    expect(page2).toHaveAttribute('href', '/?view=history&sort=amount_desc&page=2')
    await user.click(page2)
    await waitFor(() => expect(calls[calls.length - 1]).toContain('offset=12'))
    expect(sortParam(calls[calls.length - 1])).toBe('amount_desc')

    // When the default is chosen again, sort leaves the URL
    await chooseOption(user, 'Sort by', 'Date (newest first)')
    await waitFor(() => expect(window.location.search).not.toContain('sort='))
  })

  test('an unknown sort in the URL falls back to the default', async () => {
    // Given a hand-edited URL
    window.history.replaceState({}, '', '/?view=history&sort=nonsense')
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        list: (urlString) => {
          calls.push(urlString)
          return Promise.resolve(jsonResponse(200, { items: [oneItem()], count: 1, total: 1 }))
        },
      }),
    )
    render(<ReceiptHistory />)
    await screen.findByText('Store A')

    // Then the select and the request both use the default
    expect(selectValue(selectControl('Sort by'))).toBe('date_desc')
    expect(sortParam(calls[0])).toBe('date_desc')
  })

  test('"Clear filters" clears Year/Status but keeps the sort', async () => {
    const user = userEvent.setup()
    // Given a year filter and a non-default sort
    window.history.replaceState({}, '', '/?view=history&year=2026&sort=date_asc')
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [oneItem()], count: 1, total: 1 })) }),
    )
    render(<HistoryHarness />)

    // When "Clear filters" is clicked
    await user.click(await screen.findByRole('button', { name: 'Clear filters' }))

    // Then the year is gone and the sort stays
    await waitFor(() => expect(window.location.search).not.toContain('year='))
    expect(window.location.search).toContain('sort=date_asc')
  })

  test('a non-default sort alone attaches `from`, so the receipt can come back to (and step through) the sorted list', async () => {
    // Given no tab or filter, only a sort
    window.history.replaceState({}, '', '/?view=history&sort=amount_desc')
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [oneItem()], count: 1, total: 1 })) }),
    )
    render(<ReceiptHistory />)

    // Then the row link carries the sorted list as `from`
    const link = await screen.findByRole('link', { name: /store a/i })
    expect(link).toHaveAttribute(
      'href',
      `/?receipt=11111111-1111-1111-1111-111111111111&from=${encodeURIComponent('?view=history&sort=amount_desc')}`,
    )
  })

  // --- Pages (12 per page) ---------------------------------------------------

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

  test('with more than 12 receipts: "Showing 1–12 of N" and the pagination under the list; a page link loads that page and focuses the summary', async () => {
    // Given 30 receipts
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        list: (urlString) => {
          calls.push(urlString)
          return Promise.resolve(jsonResponse(200, { items: [oneItem()], count: 1, total: 30 }))
        },
      }),
    )
    const user = userEvent.setup()
    render(<HistoryHarness />)

    // Then page 1 asks for 12 from offset 0, shows the range, "Show more" is gone, and the
    // count line above the list shows the full total
    const summary = await screen.findByText('Showing 1–12 of 30')
    expect(summary).toHaveAttribute('role', 'status')
    const params = new URL(calls[0], 'http://x').searchParams
    expect(params.get('limit')).toBe('12')
    expect(params.get('offset')).toBe('0')
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
    expect(screen.getByText('30 receipts')).toHaveAttribute('role', 'status')
    const nav = screen.getByRole('navigation', { name: 'Pagination' })
    expect(within(nav).getByText('1')).toHaveAttribute('aria-current', 'page')

    // When page 2 is chosen
    await user.click(within(nav).getByRole('link', { name: 'Page 2' }))

    // Then the URL has page=2, the request offset is 12, the range follows, and focus is on the summary
    await waitFor(() => expect(window.location.search).toBe('?view=history&page=2'))
    await screen.findByText('Showing 13–24 of 30')
    expect(new URL(calls[calls.length - 1], 'http://x').searchParams.get('offset')).toBe('12')
    await waitFor(() => expect(screen.getByText('Showing 13–24 of 30')).toHaveFocus())
  })

  test('one line between the filter row and the list: "N receipts" (also with several pages), no Clear filters without a filter', async () => {
    // Given 30 receipts (three pages) and no filter
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [oneItem()], count: 1, total: 30 })) }),
    )
    render(<ReceiptHistory />)
    await screen.findByText('Showing 1–12 of 30')

    // Then right after the filter grid comes the count line, then the (empty) scroll anchor, then the list
    const row = selectControl('Year').closest('.grid') as HTMLElement
    const line = row.nextElementSibling as HTMLElement
    expect(line).toContainElement(screen.getByText('30 receipts'))
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
    const anchor = line.nextElementSibling as HTMLElement
    expect(anchor.childElementCount).toBe(0)
    expect(anchor.nextElementSibling).toContainElement(screen.getByRole('link', { name: /store a/i }))
  })

  test('active filters: Year and Status get the brand border/fill when set; Sort by never does', async () => {
    // Given only a Year filter and a non-default sort
    window.history.replaceState({}, '', '/?view=history&year=2026&sort=amount_desc')
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [oneItem()], count: 1, total: 1 })) }),
    )
    render(<ReceiptHistory />)
    await screen.findByRole('combobox', { name: 'Year' })

    // Then Year is active, Status (All) and Sort by are not
    expect(selectControl('Year')).toHaveClass('border-brand', 'bg-brand-soft')
    expect(selectControl('Year')).toHaveTextContent('2026')
    expect(selectControl('Status')).toHaveClass('border-border', 'bg-surface')
    expect(selectControl('Sort by')).toHaveClass('border-border', 'bg-surface')
    // And Clear filters sits on the count line
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
  })

  test('a page from the URL is fetched directly; invalid -> page 1; too large -> the last page, with the URL corrected', async () => {
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        list: (urlString) => {
          calls.push(urlString)
          return Promise.resolve(jsonResponse(200, { items: [oneItem()], count: 1, total: 30 }))
        },
      }),
    )

    // Given ?page=3: offset 24, "Showing 25–30 of 30"
    window.history.replaceState({}, '', '/?view=history&page=3')
    const first = render(<ReceiptHistory />)
    await screen.findByText('Showing 25–30 of 30')
    expect(new URL(calls[calls.length - 1], 'http://x').searchParams.get('offset')).toBe('24')
    first.unmount()

    // Given an invalid page: page 1
    window.history.replaceState({}, '', '/?view=history&page=abc')
    const second = render(<ReceiptHistory />)
    await screen.findByText('Showing 1–12 of 30')
    second.unmount()

    // Given a page past the end: the last page is shown and the URL says so
    window.history.replaceState({}, '', '/?view=history&page=9')
    render(<ReceiptHistory />)
    await screen.findByText('Showing 25–30 of 30')
    expect(new URL(calls[calls.length - 1], 'http://x').searchParams.get('offset')).toBe('24')
    expect(window.location.search).toBe('?view=history&page=3')
  })

  test('on a later page the row links carry the page in `from`, so "Back to history" returns there', async () => {
    // Given page 2, no other filter
    window.history.replaceState({}, '', '/?view=history&page=2')
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [oneItem()], count: 1, total: 30 })) }),
    )
    render(<ReceiptHistory />)

    // Then the row's from= is this page
    const link = await screen.findByRole('link', { name: /store a/i })
    expect(link).toHaveAttribute(
      'href',
      `/?receipt=11111111-1111-1111-1111-111111111111&from=${encodeURIComponent('?view=history&page=2')}`,
    )
  })

  test('a page link leaves ctrl/cmd-click to the browser; a plain click opens that page in place', async () => {
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [oneItem()], count: 1, total: 30 })) }),
    )
    render(<ReceiptHistory />)
    const page3 = await screen.findByRole('link', { name: 'Page 3' })

    expect(page3).toHaveAttribute('href', '/?view=history&page=3')
    expectBrowserHandlesModifiedClicks(page3, '?view=history&page=3')
  })

  test('changing a filter on page 3 goes back to page 1 (no page in the URL, offset=0)', async () => {
    // Given page 3 of 30 receipts
    window.history.replaceState({}, '', '/?view=history&page=3')
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        list: (urlString) => {
          calls.push(urlString)
          return Promise.resolve(jsonResponse(200, { items: [oneItem()], count: 1, total: 30 }))
        },
      }),
    )
    const user = userEvent.setup()
    render(<HistoryHarness />)
    await screen.findByText('Showing 25–30 of 30')

    // When the Status filter changes
    await chooseOption(user, 'Status', 'Approved')

    // Then the URL drops the page and the request starts at offset 0
    await waitFor(() => expect(window.location.search).toContain('status=approved'))
    expect(window.location.search).not.toContain('page=')
    await waitFor(() => expect(calls[calls.length - 1]).toContain('offset=0'))
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
