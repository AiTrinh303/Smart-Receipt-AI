import { useEffect, useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReceiptReport from './ReceiptReport'
import { SAMPLE_APARTMENTS, clearApartmentsCache, withApartments } from './test/apartmentsFetch'
import { expectBrowserHandlesModifiedClicks } from './test/linkClicks'

beforeEach(() => {
  window.history.replaceState({}, '', '/')
  clearApartmentsCache()
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

const OBERAUDORF = { id: 'oberaudorf-bergblick', name: 'Fewo JoJo - Oberaudorf - Bergblick' }
const WALDGLUECK = { id: 'sankt-englmar-waldglueck', name: 'Fewo JoJo - Sankt Englmar - Waldglück' }

function currencyTotal(currency: string, total: string, count: number) {
  return { currency, total, receipt_count: count }
}

function apartmentSummary(overrides: Record<string, unknown> = {}) {
  return {
    apartment_id: OBERAUDORF.id,
    apartment_name: OBERAUDORF.name,
    by_currency: [currencyTotal('EUR', '25.00', 2)],
    months: [{ month: 1, by_currency: [currencyTotal('EUR', '25.00', 2)] }],
    ...overrides,
  }
}

function emptyExcluded() {
  return { undated: 0, not_approved: 0, no_total: 0, no_currency: 0, no_apartment: 0 }
}

function reportResponse(overrides: Record<string, unknown> = {}) {
  return {
    year: 2026,
    basis: 'all',
    apartments: [
      apartmentSummary(),
      apartmentSummary({
        apartment_id: WALDGLUECK.id,
        apartment_name: WALDGLUECK.name,
        by_currency: [],
        months: [],
      }),
    ],
    overall: [currencyTotal('EUR', '25.00', 2)],
    excluded: emptyExcluded(),
    with_warnings: 0,
    counted_unreviewed: 0,
    attention: [],
    possible_duplicates: [],
    possible_duplicate_groups: 0,
    largest: [],
    ...overrides,
  }
}

interface Routes {
  years?: () => Promise<unknown>
  yearly?: (urlString: string) => Promise<unknown>
}

function routeFetch(routes: Routes = {}) {
  return (url: unknown) => {
    const urlString = String(url)
    if (urlString.includes('/reports/years')) {
      return routes.years
        ? routes.years()
        : Promise.resolve(jsonResponse(200, { items: [2026, 2025] }))
    }
    if (urlString.includes('/reports/yearly')) {
      return routes.yearly
        ? routes.yearly(urlString)
        : Promise.resolve(jsonResponse(200, reportResponse()))
    }
    return Promise.reject(new Error(`Unexpected fetch call to ${urlString}`))
  }
}

/** Mirrors App.tsx's own key={locationKey}/popstate remount behavior, so
 * tests can exercise real year/checkbox navigation (which fully remounts
 * ReceiptReport in the real app) without rendering the whole App. */
function ReportHarness() {
  const [key, setKey] = useState(() => window.location.search)
  useEffect(() => {
    const handlePopState = () => setKey(window.location.search)
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])
  return <ReceiptReport key={key} />
}

describe('ReceiptReport', () => {
  let fetchSpy: jest.Mock

  beforeEach(() => {
    fetchSpy = jest.fn().mockImplementation(withApartments(routeFetch()))
    global.fetch = fetchSpy as unknown as typeof fetch
  })

  afterEach(() => {
    // @ts-expect-error cleaning up the test-only global fetch stub
    delete global.fetch
  })

  test('years load and the newest is selected by default', async () => {
    render(<ReceiptReport />)
    await waitFor(() => {
      expect(screen.getByLabelText('Year')).toHaveValue('2026')
    })
    const yearlyCall = fetchSpy.mock.calls.find(([url]) => String(url).includes('/reports/yearly'))!
    expect(String(yearlyCall[0])).toContain('year=2026')
  })

  test('the default request sends no basis param and shows no "Estimates only" text', async () => {
    render(<ReceiptReport />)
    await waitFor(() => {
      expect(screen.getByLabelText('Year')).toBeInTheDocument()
    })
    const yearlyCall = fetchSpy.mock.calls.find(([url]) => String(url).includes('/reports/yearly'))!
    expect(String(yearlyCall[0])).not.toContain('basis=')
    expect(screen.queryByText(/estimates only/i)).not.toBeInTheDocument()
  })

  test('each apartment card and the combined card show their per-currency totals and counts', async () => {
    render(<ReceiptReport />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Bergblick' })).toBeInTheDocument()
    })
    expect(screen.getAllByText('€25.00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('2 receipts').length).toBeGreaterThan(0)
    expect(screen.getByText('Both apartments')).toBeInTheDocument()
  })

  test('two currencies are never merged -- shown as separate lines', async () => {
    fetchSpy.mockImplementation(
      routeFetch({
        yearly: () =>
          Promise.resolve(
            jsonResponse(
              200,
              reportResponse({
                apartments: [
                  apartmentSummary({
                    by_currency: [currencyTotal('EUR', '10.00', 1), currencyTotal('USD', '20.00', 1)],
                  }),
                  apartmentSummary({ apartment_id: WALDGLUECK.id, apartment_name: WALDGLUECK.name, by_currency: [], months: [] }),
                ],
                overall: [currencyTotal('EUR', '10.00', 1), currencyTotal('USD', '20.00', 1)],
              }),
            ),
          ),
      }),
    )
    render(<ReceiptReport />)
    await waitFor(() => {
      expect(screen.getAllByText('€10.00').length).toBeGreaterThan(0)
    })
    expect(screen.getAllByText('USD 20.00').length).toBeGreaterThan(0)
  })

  test('an apartment with no data shows the right empty message for the current basis', async () => {
    render(<ReceiptReport />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Waldglück' })).toBeInTheDocument()
    })
    expect(screen.getByText('No receipts in 2026.')).toBeInTheDocument()
  })

  test('the monthly table omits empty months and has a column per apartment, no combined column', async () => {
    fetchSpy.mockImplementation(
      routeFetch({
        yearly: () =>
          Promise.resolve(
            jsonResponse(
              200,
              reportResponse({
                apartments: [
                  apartmentSummary({
                    months: [
                      { month: 1, by_currency: [currencyTotal('EUR', '10.00', 1)] },
                      { month: 3, by_currency: [currencyTotal('EUR', '15.00', 1)] },
                    ],
                  }),
                  apartmentSummary({ apartment_id: WALDGLUECK.id, apartment_name: WALDGLUECK.name, by_currency: [], months: [] }),
                ],
              }),
            ),
          ),
      }),
    )
    render(<ReceiptReport />)
    await waitFor(() => {
      expect(screen.getByText('January')).toBeInTheDocument()
    })
    expect(screen.getByText('March')).toBeInTheDocument()
    expect(screen.queryByText('February')).not.toBeInTheDocument()
    expect(screen.queryByText('Both')).not.toBeInTheDocument()
    expect(screen.getAllByText('Bergblick').length).toBeGreaterThan(0)
  })

  test('switching the year updates the URL and refetches', async () => {
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        yearly: (urlString) => {
          calls.push(urlString)
          return Promise.resolve(jsonResponse(200, reportResponse()))
        },
      }),
    )
    const user = userEvent.setup()
    render(<ReportHarness />)
    await waitFor(() => {
      expect(screen.getByLabelText('Year')).toHaveValue('2026')
    })

    await user.selectOptions(screen.getByLabelText('Year'), '2025')

    await waitFor(() => expect(window.location.search).toContain('year=2025'))
    expect(calls[calls.length - 1]).toContain('year=2025')
  })

  test('checking the checkbox adds basis=approved to the URL and refetches', async () => {
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        yearly: (urlString) => {
          calls.push(urlString)
          return Promise.resolve(jsonResponse(200, reportResponse()))
        },
      }),
    )
    const user = userEvent.setup()
    render(<ReportHarness />)
    await waitFor(() => {
      expect(screen.getByLabelText('Only count receipts I approved')).toBeInTheDocument()
    })

    await user.click(screen.getByLabelText('Only count receipts I approved'))

    await waitFor(() => expect(window.location.search).toContain('basis=approved'))
    expect(calls[calls.length - 1]).toContain('basis=approved')
  })

  test('counted_unreviewed > 0 shows the info line; 0 shows nothing', async () => {
    fetchSpy.mockImplementation(
      routeFetch({
        yearly: () => Promise.resolve(jsonResponse(200, reportResponse({ counted_unreviewed: 3 }))),
      }),
    )
    const { unmount } = render(<ReceiptReport />)
    await waitFor(() => {
      expect(
        screen.getByText('3 of the counted receipts were not reviewed. The quick check below shows what to look at first.'),
      ).toBeInTheDocument()
    })
    unmount()

    fetchSpy.mockImplementation(
      routeFetch({ yearly: () => Promise.resolve(jsonResponse(200, reportResponse({ counted_unreviewed: 0 }))) }),
    )
    render(<ReceiptReport />)
    await waitFor(() => {
      expect(screen.getByText('Both apartments')).toBeInTheDocument()
    })
    expect(screen.queryByText(/were not reviewed/i)).not.toBeInTheDocument()
  })

  test('the three Quick check blocks show their counts, closed by default', async () => {
    fetchSpy.mockImplementation(
      routeFetch({
        yearly: () =>
          Promise.resolve(
            jsonResponse(
              200,
              reportResponse({
                with_warnings: 2,
                attention: [
                  {
                    receipt_id: 'r1',
                    store_name: 'Store A',
                    purchase_date: '2026-01-15',
                    total: '19.99',
                    currency: 'EUR',
                    apartment_id: OBERAUDORF.id,
                    warning_codes: ['MISSING_STORE'],
                  },
                ],
                possible_duplicate_groups: 1,
                possible_duplicates: [
                  {
                    receipt_ids: ['d1', 'd2'],
                    store_name: 'Store B',
                    purchase_date: '2026-02-01',
                    total: '10.00',
                    currency: 'EUR',
                    apartment_id: OBERAUDORF.id,
                  },
                ],
                largest: [{ currency: 'EUR', items: [] }],
              }),
            ),
          ),
      }),
    )
    render(<ReceiptReport />)
    await waitFor(() => {
      expect(screen.getByText('Receipts with warnings (2)')).toBeInTheDocument()
    })
    expect(screen.getByText('Possible duplicates (1 groups)')).toBeInTheDocument()
    expect(screen.getByText('Largest receipts')).toBeInTheDocument()

    const details = document.querySelectorAll('details')
    details.forEach((detail) => expect((detail as HTMLDetailsElement).open).toBe(false))
  })

  test('a warning receipt shows the plain-words label and a link to ?receipt=<id>', async () => {
    fetchSpy.mockImplementation(
      routeFetch({
        yearly: () =>
          Promise.resolve(
            jsonResponse(
              200,
              reportResponse({
                with_warnings: 1,
                attention: [
                  {
                    receipt_id: 'r1',
                    store_name: 'Store A',
                    purchase_date: '2026-01-15',
                    total: '19.99',
                    currency: 'EUR',
                    apartment_id: OBERAUDORF.id,
                    warning_codes: ['TOTAL_MISMATCH', 'SOME_OTHER_CODE'],
                  },
                ],
              }),
            ),
          ),
      }),
    )
    render(<ReceiptReport />)
    const link = await screen.findByRole('link', { name: 'Store A' })
    expect(link).toHaveAttribute('href', '/?receipt=r1')
    expect(screen.getByText('total does not match the items, SOME_OTHER_CODE')).toBeInTheDocument()
  })

  test('a receipt link leaves ctrl/cmd-click to the browser; a plain click still opens it in place', async () => {
    // Given a receipt link in the Quick check
    fetchSpy.mockImplementation(
      routeFetch({
        yearly: () =>
          Promise.resolve(
            jsonResponse(
              200,
              reportResponse({
                with_warnings: 1,
                attention: [
                  {
                    receipt_id: 'r1',
                    store_name: 'Store A',
                    purchase_date: '2026-01-15',
                    total: '19.99',
                    currency: 'EUR',
                    apartment_id: OBERAUDORF.id,
                    warning_codes: ['TOTAL_MISMATCH'],
                  },
                ],
              }),
            ),
          ),
      }),
    )
    render(<ReceiptReport />)
    const link = await screen.findByRole('link', { name: 'Store A' })

    // Then modified clicks are not prevented, and a plain click navigates
    expectBrowserHandlesModifiedClicks(link, '?receipt=r1')
  })

  test('"Showing the first 50." appears only when with_warnings exceeds the attention list', async () => {
    const attention = Array.from({ length: 50 }, (_, i) => ({
      receipt_id: `r${i}`,
      store_name: `Store ${i}`,
      purchase_date: '2026-01-15',
      total: '1.00',
      currency: 'EUR',
      apartment_id: OBERAUDORF.id,
      warning_codes: ['MISSING_STORE'],
    }))
    fetchSpy.mockImplementation(
      routeFetch({
        yearly: () =>
          Promise.resolve(jsonResponse(200, reportResponse({ with_warnings: 60, attention }))),
      }),
    )
    render(<ReceiptReport />)
    await waitFor(() => {
      expect(screen.getByText('Showing the first 50.')).toBeInTheDocument()
    })
  })

  test('a duplicate group shows one "Open N" link per receipt and the counted-until-deleted note', async () => {
    fetchSpy.mockImplementation(
      routeFetch({
        yearly: () =>
          Promise.resolve(
            jsonResponse(
              200,
              reportResponse({
                possible_duplicate_groups: 1,
                possible_duplicates: [
                  {
                    receipt_ids: ['d1', 'd2', 'd3'],
                    store_name: 'Store B',
                    purchase_date: '2026-02-01',
                    total: '10.00',
                    currency: 'EUR',
                    apartment_id: OBERAUDORF.id,
                  },
                ],
              }),
            ),
          ),
      }),
    )
    render(<ReceiptReport />)
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Open 1' })).toHaveAttribute('href', '/?receipt=d1')
    })
    expect(screen.getByRole('link', { name: 'Open 2' })).toHaveAttribute('href', '/?receipt=d2')
    expect(screen.getByRole('link', { name: 'Open 3' })).toHaveAttribute('href', '/?receipt=d3')
    expect(screen.getByText('Both are counted in the totals until you delete one.')).toBeInTheDocument()
  })

  test('when nothing needs attention, the Quick check success Alert is shown', async () => {
    render(<ReceiptReport />)
    await waitFor(() => {
      expect(screen.getByText('No warnings and no duplicates found in 2026.')).toBeInTheDocument()
    })
  })

  test('the "Receipts not in these totals" panel links and the VAT line', async () => {
    fetchSpy.mockImplementation(
      routeFetch({
        yearly: () =>
          Promise.resolve(
            jsonResponse(
              200,
              reportResponse({
                basis: 'approved',
                excluded: { undated: 2, not_approved: 3, no_total: 1, no_currency: 1, no_apartment: 1 },
                with_warnings: 4,
              }),
            ),
          ),
      }),
    )
    window.history.replaceState({}, '', '/?view=report&year=2026&basis=approved')
    render(<ReceiptReport />)

    const notApprovedLink = await screen.findByRole('link', {
      name: '3 receipts in 2026 are not approved yet',
    })
    expect(notApprovedLink).toHaveAttribute('href', '/?view=history&year=2026&status=needs_review')

    const undatedLink = screen.getByRole('link', { name: '2 receipts have no valid date' })
    expect(undatedLink).toHaveAttribute('href', '/?view=history&year=none')

    expect(screen.getByText(/1 receipt has no total/)).toBeInTheDocument()
    expect(screen.getByText(/1 receipt has no currency/)).toBeInTheDocument()
    expect(screen.getByText(/1 receipt has no apartment/)).toBeInTheDocument()
    expect(screen.getByText(/4 counted receipts still have warnings/)).toBeInTheDocument()

    expect(
      screen.getByText('Totals are the amounts printed on the receipts, including VAT. Ask your tax advisor how to use them.'),
    ).toBeInTheDocument()
  })

  test('the "not approved" link is hidden when basis=all, even if excluded.not_approved were somehow nonzero', async () => {
    fetchSpy.mockImplementation(
      routeFetch({
        yearly: () =>
          Promise.resolve(
            jsonResponse(200, reportResponse({ basis: 'all', excluded: { ...emptyExcluded(), not_approved: 2 } })),
          ),
      }),
    )
    render(<ReceiptReport />)
    await waitFor(() => {
      expect(screen.getByText('Both apartments')).toBeInTheDocument()
    })
    expect(screen.queryByText(/are not approved yet/)).not.toBeInTheDocument()
  })

  test('when every excluded count is zero, the excluded panel shows its own success Alert', async () => {
    render(<ReceiptReport />)
    await waitFor(() => {
      expect(screen.getByText('Every receipt of 2026 is in these totals.')).toBeInTheDocument()
    })
  })

  test('decimal string amounts display exactly as given, including negative and "0.00"', async () => {
    fetchSpy.mockImplementation(
      routeFetch({
        yearly: () =>
          Promise.resolve(
            jsonResponse(
              200,
              reportResponse({
                apartments: [
                  apartmentSummary({ by_currency: [currencyTotal('EUR', '-12.50', 1)] }),
                  apartmentSummary({ apartment_id: WALDGLUECK.id, apartment_name: WALDGLUECK.name, by_currency: [currencyTotal('USD', '0.00', 1)], months: [] }),
                ],
                overall: [currencyTotal('EUR', '-12.50', 1), currencyTotal('USD', '0.00', 1)],
              }),
            ),
          ),
      }),
    )
    render(<ReceiptReport />)
    await waitFor(() => {
      expect(screen.getAllByText('-€12.50').length).toBeGreaterThan(0)
    })
    expect(screen.getAllByText('USD 0.00').length).toBeGreaterThan(0)
  })

  test('loading state shows the exact text "Loading report..." in a busy status region', async () => {
    const deferred = createDeferred<unknown>()
    fetchSpy.mockImplementation(routeFetch({ years: () => deferred.promise }))
    render(<ReceiptReport />)

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Loading report...')).toBeInTheDocument()

    deferred.resolve(jsonResponse(200, { items: [2026] }))
    await waitFor(() => expect(screen.getByLabelText('Year')).toBeInTheDocument())
  })

  test('error state shows an Alert with Retry, which reloads on click', async () => {
    let callCount = 0
    fetchSpy.mockImplementation(
      routeFetch({
        years: () => {
          callCount += 1
          if (callCount === 1) {
            return Promise.resolve(jsonResponse(500, { detail: 'Internal error' }))
          }
          return Promise.resolve(jsonResponse(200, { items: [2026] }))
        },
      }),
    )
    const user = userEvent.setup()
    render(<ReceiptReport />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not load the yearly report. Please try again.')
    })

    await user.click(screen.getByRole('button', { name: /retry/i }))

    await waitFor(() => {
      expect(screen.getByLabelText('Year')).toBeInTheDocument()
    })
    expect(callCount).toBe(2)
  })

  test('network failure shows the generic network error message', async () => {
    fetchSpy.mockImplementation(
      routeFetch({ years: () => Promise.reject(new TypeError('Failed to fetch')) }),
    )
    render(<ReceiptReport />)
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not reach the server. Please try again.')
    })
  })

  test('no years yet shows the empty-state message, no Year select', async () => {
    fetchSpy.mockImplementation(routeFetch({ years: () => Promise.resolve(jsonResponse(200, { items: [] })) }))
    render(<ReceiptReport />)
    await waitFor(() => {
      expect(
        screen.getByText('No dated receipts yet. Upload and approve receipts to see the report.'),
      ).toBeInTheDocument()
    })
    expect(screen.queryByLabelText('Year')).not.toBeInTheDocument()
  })

  test('a reply to an older (stale) request never overwrites the newer result', async () => {
    const olderYears = createDeferred<unknown>()
    let callCount = 0

    fetchSpy.mockImplementation(
      routeFetch({
        years: () => {
          callCount += 1
          return callCount === 1 ? olderYears.promise : Promise.resolve(jsonResponse(200, { items: [2026] }))
        },
      }),
    )

    // Given the older (stale) request starts first
    const { unmount } = render(<ReceiptReport />)

    // When a newer request starts (remount, as a real navigation would do)
    // before the older one has resolved
    unmount()
    render(<ReceiptReport />)

    await waitFor(() => {
      expect(screen.getByLabelText('Year')).toBeInTheDocument()
    })

    // And only then does the older, now-stale request resolve
    olderYears.resolve(jsonResponse(200, { items: [] }))

    // Then the stale response never overwrites the newer, already-shown result
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByLabelText('Year')).toBeInTheDocument()
  })

  function mockMatchMedia(matches: boolean) {
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }))
  }

  afterEach(() => {
    // @ts-expect-error cleaning up the test-only global matchMedia stub
    delete window.matchMedia
  })

  test('small screen (matchMedia matches): monthly cards render, not a table', async () => {
    mockMatchMedia(true)
    render(<ReceiptReport />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Bergblick' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  test('large screen (matchMedia does not match): the monthly table renders, no cards', async () => {
    mockMatchMedia(false)
    render(<ReceiptReport />)
    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument()
    })
  })
})

describe('ReceiptReport export controls (For your tax advisor)', () => {
  let fetchSpy: jest.Mock

  beforeEach(() => {
    fetchSpy = jest.fn().mockImplementation(withApartments(routeFetch()))
    global.fetch = fetchSpy as unknown as typeof fetch
  })

  afterEach(() => {
    // @ts-expect-error cleaning up the test-only global fetch stub
    delete global.fetch
  })

  const API_URL = 'http://localhost:8001'

  async function renderReady() {
    render(<ReportHarness />)
    await waitFor(() => {
      expect(screen.getByLabelText('Year')).toHaveValue('2026')
    })
  }

  function zipLink() {
    return screen.getByRole('link', { name: /download zip/i })
  }

  function csvLink() {
    return screen.getByRole('link', { name: /download csv only/i })
  }

  test('the two links have the exact hrefs for the default choices', async () => {
    await renderReady()
    expect(zipLink()).toHaveAttribute(
      'href',
      `${API_URL}/reports/yearly/export.zip?year=2026&style=excel_de`,
    )
    expect(csvLink()).toHaveAttribute(
      'href',
      `${API_URL}/reports/yearly/export.csv?year=2026&style=excel_de`,
    )
    expect(screen.getByText('2026, all receipts')).toBeInTheDocument()
  })

  test('changing the year updates both hrefs', async () => {
    await renderReady()
    await userEvent.selectOptions(screen.getByLabelText('Year'), '2025')
    await waitFor(() => {
      expect(zipLink()).toHaveAttribute(
        'href',
        `${API_URL}/reports/yearly/export.zip?year=2025&style=excel_de`,
      )
    })
    expect(csvLink()).toHaveAttribute(
      'href',
      `${API_URL}/reports/yearly/export.csv?year=2025&style=excel_de`,
    )
  })

  test('the checkbox switches basis -- hrefs and the visible text update', async () => {
    await renderReady()
    await userEvent.click(screen.getByLabelText('Only count receipts I approved'))
    await waitFor(() => {
      expect(zipLink()).toHaveAttribute(
        'href',
        `${API_URL}/reports/yearly/export.zip?year=2026&basis=approved&style=excel_de`,
      )
    })
    expect(csvLink()).toHaveAttribute(
      'href',
      `${API_URL}/reports/yearly/export.csv?year=2026&basis=approved&style=excel_de`,
    )
    expect(screen.getByText('2026, approved receipts only')).toBeInTheDocument()
    expect(screen.queryByText('2026, all receipts')).not.toBeInTheDocument()
  })

  test('choosing an apartment adds apartment_id to both hrefs', async () => {
    await renderReady()
    await waitFor(() => {
      expect(screen.getByLabelText('Apartment')).toHaveValue('')
    })
    await userEvent.selectOptions(screen.getByLabelText('Apartment'), SAMPLE_APARTMENTS[0].id)
    expect(zipLink()).toHaveAttribute(
      'href',
      `${API_URL}/reports/yearly/export.zip?year=2026&style=excel_de&apartment_id=${SAMPLE_APARTMENTS[0].id}`,
    )
    expect(csvLink()).toHaveAttribute(
      'href',
      `${API_URL}/reports/yearly/export.csv?year=2026&style=excel_de&apartment_id=${SAMPLE_APARTMENTS[0].id}`,
    )
  })

  test('choosing the plain format sends style=plain; the default sends style=excel_de', async () => {
    await renderReady()
    expect(zipLink()).toHaveAttribute('href', expect.stringContaining('style=excel_de'))

    await userEvent.selectOptions(screen.getByLabelText('CSV format'), 'plain')
    expect(zipLink()).toHaveAttribute('href', expect.stringContaining('style=plain'))
    expect(csvLink()).toHaveAttribute('href', expect.stringContaining('style=plain'))
  })

  test('no fetch is ever made for the export links -- only /reports/years and /reports/yearly and /apartments', async () => {
    await renderReady()
    await userEvent.selectOptions(screen.getByLabelText('CSV format'), 'plain')
    await userEvent.selectOptions(screen.getByLabelText('Apartment'), SAMPLE_APARTMENTS[0].id)
    for (const [url] of fetchSpy.mock.calls) {
      expect(String(url)).not.toContain('/export.')
    }
  })

  test('disabled state when there are no years: non-interactive links with the "Nothing to export yet" hint', async () => {
    fetchSpy.mockImplementation(
      withApartments(routeFetch({ years: () => Promise.resolve(jsonResponse(200, { items: [] })) })),
    )
    render(<ReceiptReport />)
    await waitFor(() => {
      expect(screen.getByText('Nothing to export yet.')).toBeInTheDocument()
    })
    expect(screen.queryByRole('link', { name: /download zip/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /download csv only/i })).not.toBeInTheDocument()
    const disabled = screen.getAllByText(/download (zip|csv only)/i)
    expect(disabled.length).toBeGreaterThan(0)
    for (const element of disabled) {
      const container = element.closest('[aria-disabled]')
      expect(container).toHaveAttribute('aria-disabled', 'true')
    }
  })

  test('the "not reviewed" line appears only when basis is all and counted_unreviewed > 0', async () => {
    fetchSpy.mockImplementation(
      withApartments(
        routeFetch({
          yearly: () =>
            Promise.resolve(jsonResponse(200, reportResponse({ counted_unreviewed: 3 }))),
        }),
      ),
    )
    await renderReady()
    expect(screen.getByText('Receipts that were not reviewed are included.')).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('Only count receipts I approved'))
    await waitFor(() => {
      expect(screen.getByText('2026, approved receipts only')).toBeInTheDocument()
    })
    expect(screen.queryByText('Receipts that were not reviewed are included.')).not.toBeInTheDocument()
  })

  test('counted_unreviewed = 0 under basis all shows no "not reviewed" line', async () => {
    await renderReady()
    expect(screen.queryByText('Receipts that were not reviewed are included.')).not.toBeInTheDocument()
  })
})
