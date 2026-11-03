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
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: THREE_ITEMS, count: 3 })) }),
    )

    // When the history view is rendered
    render(<ReceiptHistory />)

    // Then three rows are shown in the same order the server returned them
    await waitFor(() => {
      expect(screen.getByText('Store C')).toBeInTheDocument()
    })
    const rows = screen.getAllByRole('button', { name: /store/i })
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
        list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0 })),
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
        list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0 })),
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
        list: () => Promise.resolve(jsonResponse(200, { items: THREE_ITEMS, count: 3 })),
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
        list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0 })),
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
            }),
          ),
      }),
    )

    render(<ReceiptHistory />)

    await waitFor(() => {
      expect(screen.getByText(OBERAUDORF.name)).toBeInTheDocument()
    })
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
            }),
          ),
      }),
    )

    render(<ReceiptHistory />)

    await waitFor(() => {
      expect(screen.getAllByText('Not assigned')).toHaveLength(2)
    })
  })

  test('a row shows its status as a badge', async () => {
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
              ],
              count: 1,
            }),
          ),
      }),
    )

    render(<ReceiptHistory />)

    await waitFor(() => {
      expect(within(screen.getByRole('list')).getByText('Approved')).toBeInTheDocument()
    })
  })

  // --- Tabs ----------------------------------------------------------------

  test('tabs render with counts from the facets', async () => {
    fetchSpy.mockImplementation(
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0 })) }),
    )
    render(<ReceiptHistory />)

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'All apartments (3)' })).toBeInTheDocument()
    })
    expect(screen.getByRole('tab', { name: `${OBERAUDORF.name} (2)` })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: `${WALDGLUECK.name} (1)` })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'All apartments (3)' })).toHaveAttribute('aria-selected', 'true')
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
        list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0 })),
      }),
    )
    render(<HistoryHarness />)
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: `${OBERAUDORF.name} (2)` })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('tab', { name: `${OBERAUDORF.name} (2)` }))

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
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0 })) }),
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
      expect(screen.getByRole('tab', { name: `${OBERAUDORF.name} (2)` })).toHaveFocus()
    })

    await user.keyboard('{ArrowRight}')
    await waitFor(() => {
      expect(window.location.search).toContain(`apartment=${WALDGLUECK.id}`)
    })
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: `${WALDGLUECK.name} (1)` })).toHaveFocus()
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
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [item], count: 1 })) }),
    )
    const { unmount } = render(<ReceiptHistory />)
    await waitFor(() => {
      expect(screen.getByText(OBERAUDORF.name)).toBeInTheDocument()
    })
    unmount()

    // A specific apartment tab -- badge hidden (redundant)
    window.history.replaceState({}, '', `/?view=history&apartment=${OBERAUDORF.id}`)
    render(<ReceiptHistory />)
    await waitFor(() => {
      expect(screen.getByText('Store A')).toBeInTheDocument()
    })
    expect(screen.queryByText(OBERAUDORF.name)).not.toBeInTheDocument()
  })

  // --- Filters ---------------------------------------------------------------

  test('each select sends its own param', async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        list: (urlString) => {
          calls.push(urlString)
          return Promise.resolve(jsonResponse(200, { items: [], count: 0 }))
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
        list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0 })),
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
        list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0 })),
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
          return Promise.resolve(jsonResponse(200, { items: [], count: 0 }))
        },
      }),
    )

    render(<ReceiptHistory />)

    await waitFor(() => {
      expect(capturedUrl).toContain(`apartment_id=${OBERAUDORF.id}`)
    })
    expect(capturedUrl).toContain('year=2025')
    expect(capturedUrl).toContain('status=approved')
    expect(screen.getByRole('tab', { name: `${OBERAUDORF.name} (2)` })).toHaveAttribute('aria-selected', 'true')
  })

  test('invalid URL values are ignored, showing the unfiltered result for that value', async () => {
    window.history.replaceState({}, '', '/?view=history&apartment=does-not-exist&year=25&status=archived')
    let capturedUrl = ''
    fetchSpy.mockImplementation(
      routeFetch({
        list: (urlString) => {
          capturedUrl = urlString
          return Promise.resolve(jsonResponse(200, { items: THREE_ITEMS, count: 3 }))
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
          return Promise.resolve(jsonResponse(200, { items: [], count: 0 }))
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
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0 })) }),
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
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0 })) }),
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
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0 })) }),
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
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0 })) }),
    )
    render(<HistoryHarness />)
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: `${OBERAUDORF.name} (2)` })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('tab', { name: `${OBERAUDORF.name} (2)` }))
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
      routeFetch({ list: () => Promise.resolve(jsonResponse(200, { items: THREE_ITEMS, count: 3 })) }),
    )
    render(<ReceiptHistory />)
    await waitFor(() => {
      expect(screen.getByText('3 receipts')).toBeInTheDocument()
    })
    expect(screen.getByText('3 receipts')).toHaveAttribute('role', 'status')
  })
})
