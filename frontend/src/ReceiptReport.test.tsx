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

  test('each apartment card takes its tone\'s stronger tint and border (no dot); Both apartments is a neutral slate-100 card', async () => {
    // Given the default report with both apartments
    render(<ReceiptReport />)
    const waldglueck = await screen.findByRole('heading', { name: 'Waldglück' })
    const bergblick = screen.getByRole('heading', { name: 'Bergblick' })

    // Then each card has its tone's soft fill and faint border, and no dot
    expect(bergblick.parentElement).toHaveClass('bg-apartment-sky-tint', 'border-apartment-sky-border')
    expect(waldglueck.parentElement).toHaveClass('bg-apartment-fuchsia-tint', 'border-apartment-fuchsia-border')
    expect(bergblick.querySelector('[aria-hidden="true"]')).toBeNull()
    expect(waldglueck.querySelector('[aria-hidden="true"]')).toBeNull()
    // And "Both apartments" is neutral: slate-100 with the decorative border, no brand border
    const both = screen.getByRole('heading', { name: 'Both apartments' }).parentElement as HTMLElement
    expect(both).toHaveClass('bg-slate-100', 'border-border-subtle')
    expect(both).not.toHaveClass('border-brand')
  })

  test('an apartment id with no tone gets the plain card', async () => {
    // Given an apartment the tone map doesn't know
    fetchSpy.mockImplementation(
      routeFetch({
        yearly: () =>
          Promise.resolve(
            jsonResponse(
              200,
              reportResponse({ apartments: [apartmentSummary({ apartment_id: 'elsewhere', apartment_name: 'Elsewhere' })] }),
            ),
          ),
      }),
    )
    render(<ReceiptReport />)

    // Then its card is the plain white one
    const heading = await screen.findByRole('heading', { name: 'Elsewhere' })
    expect(heading.parentElement).toHaveClass('bg-surface', 'border-border-subtle')
  })

  test('the page description follows "Only count receipts I approved"', async () => {
    // Given the default basis (all receipts)
    const { unmount } = render(<ReceiptReport />)
    await screen.findByRole('heading', { name: 'Bergblick' })

    // Then the description says every saved receipt counts
    expect(screen.getByText('Spending per apartment, from every saved receipt.')).toBeInTheDocument()
    expect(screen.queryByText('Spending per apartment, from the receipts you approved.')).not.toBeInTheDocument()
    unmount()

    // Given basis=approved
    window.history.replaceState({}, '', '/?view=report&year=2026&basis=approved')
    render(<ReceiptReport />)
    await screen.findByRole('heading', { name: 'Bergblick' })

    // Then it says only approved receipts count
    expect(screen.getByText('Spending per apartment, from the receipts you approved.')).toBeInTheDocument()
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

  test('"Show by month" is a closed details right under the summary cards (no card of its own), all 12 months with a dash where empty', async () => {
    // Given one apartment with January and March data, in one currency
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
    const summary = await screen.findByText('Show by month')

    // Then it's a closed <details> placed directly after the summary cards, not inside a Card
    const details = summary.closest('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(details.previousElementSibling).toContainElement(screen.getByRole('heading', { name: 'Both apartments' }))
    expect(details.parentElement?.className).not.toMatch(/rounded-card/)

    // And every month January..December is a row, a dash where there's no data
    const table = within(details).getByRole('table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((row) => row.firstElementChild?.textContent)).toEqual([
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ])
    expect(rows[1]).toHaveTextContent('—')
    expect(rows[2]).toHaveTextContent('15.00')
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Month',
      'Bergblick',
      'Waldglück',
    ])
    expect(within(details).queryByRole('heading', { name: '€' })).not.toBeInTheDocument()
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

  /** The export card (the note lives inside it). */
  function exportCard(): HTMLElement {
    return screen.getByRole('heading', { name: 'For your tax advisor' }).parentElement as HTMLElement
  }

  test('basis all: the export note says "N not reviewed · M with warnings" with a "Review them" link, leaving out a zero part', async () => {
    // Given 3 unreviewed and 2 with warnings
    fetchSpy.mockImplementation(
      routeFetch({
        yearly: () => Promise.resolve(jsonResponse(200, reportResponse({ counted_unreviewed: 3, with_warnings: 2 }))),
      }),
    )
    const { unmount } = render(<ReceiptReport />)

    // Then one line inside the export card says both, with the review link
    const line = await within(await waitFor(() => exportCard())).findByText('3 not reviewed · 2 with warnings')
    expect(line.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    expect(within(exportCard()).getByRole('link', { name: 'Review them' })).toHaveAttribute(
      'href',
      '/?view=history&year=2026&status=needs_review',
    )
    unmount()

    // Given only warnings
    fetchSpy.mockImplementation(
      routeFetch({ yearly: () => Promise.resolve(jsonResponse(200, reportResponse({ with_warnings: 2 }))) }),
    )
    render(<ReceiptReport />)

    // Then the zero part is left out, and there is no review link (nothing to review)
    expect(await screen.findByText('2 with warnings')).toBeInTheDocument()
    expect(screen.queryByText(/not reviewed/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Review them' })).not.toBeInTheDocument()
  })

  test('possible duplicates: counted in the note line, with a closed "Show possible duplicates" list of groups and "Open N" links', async () => {
    // Given 5 unreviewed, 2 with warnings and 1 duplicate group
    fetchSpy.mockImplementation(
      routeFetch({
        yearly: () =>
          Promise.resolve(
            jsonResponse(
              200,
              reportResponse({
                counted_unreviewed: 5,
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
                    total: '1000.00',
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

    // Then the note's first line counts the group, singular
    expect(await screen.findByText('5 not reviewed · 2 with warnings · 1 possible duplicate')).toBeInTheDocument()

    // And a closed "Show possible duplicates" holds the group: store, date, total, one "Open N" per receipt
    const details = within(exportCard()).getByText('Show possible duplicates').closest('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(within(details).getByText('Store B, 01.02.2026, €1,000.00')).toBeInTheDocument()
    expect(within(details).getByRole('link', { name: 'Open 1' })).toHaveAttribute('href', '/?receipt=d1')
    expect(within(details).getByRole('link', { name: 'Open 2' })).toHaveAttribute('href', '/?receipt=d2')
    expect(within(details).getByText('Both are counted in the totals until you delete one.')).toBeInTheDocument()

    // And the warnings list and the old checks card stay gone
    expect(screen.queryByRole('link', { name: 'Store A' })).not.toBeInTheDocument()
    expect(screen.queryByText('Before you send it')).not.toBeInTheDocument()
  })

  test('several duplicate groups read as plural; an "Open N" link opens in place on a plain click and leaves ctrl/cmd-click to the browser', async () => {
    // Given 2 duplicate groups (only duplicates open)
    const group = (ids: string[]) => ({
      receipt_ids: ids,
      store_name: 'Store B',
      purchase_date: '2026-02-01',
      total: '10.00',
      currency: 'EUR',
      apartment_id: OBERAUDORF.id,
    })
    fetchSpy.mockImplementation(
      routeFetch({
        yearly: () =>
          Promise.resolve(
            jsonResponse(
              200,
              reportResponse({ possible_duplicate_groups: 2, possible_duplicates: [group(['a1', 'a2']), group(['b1', 'b2'])] }),
            ),
          ),
      }),
    )
    render(<ReceiptReport />)

    // Then the line reads "2 possible duplicates", with no review link (nothing unreviewed)
    expect(await screen.findByText('2 possible duplicates')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Review them' })).not.toBeInTheDocument()
    // And an "Open" link behaves like every internal link
    expectBrowserHandlesModifiedClicks(screen.getAllByRole('link', { name: 'Open 1' })[0], '?receipt=a1')
  })

  test('with no possible duplicates the note has no duplicates part and no list', async () => {
    // Given warnings but no duplicates
    fetchSpy.mockImplementation(
      routeFetch({ yearly: () => Promise.resolve(jsonResponse(200, reportResponse({ with_warnings: 2 }))) }),
    )
    render(<ReceiptReport />)

    // Then neither the count nor the list appears
    expect(await screen.findByText('2 with warnings')).toBeInTheDocument()
    expect(screen.queryByText(/possible duplicate/)).not.toBeInTheDocument()
    expect(screen.queryByText('Show possible duplicates')).not.toBeInTheDocument()
  })

  test('the "Review them" link leaves ctrl/cmd-click to the browser; a plain click still opens the list in place', async () => {
    // Given unreviewed receipts, so the export note shows its link
    fetchSpy.mockImplementation(
      routeFetch({ yearly: () => Promise.resolve(jsonResponse(200, reportResponse({ counted_unreviewed: 2 }))) }),
    )
    render(<ReceiptReport />)
    const link = await screen.findByRole('link', { name: 'Review them' })

    // Then modified clicks are not prevented, and a plain click navigates
    expectBrowserHandlesModifiedClicks(link, '?view=history&year=2026&status=needs_review')
  })

  test('when nothing is open, the export card has no note at all', async () => {
    // Given the default report (nothing open)
    render(<ReceiptReport />)
    await screen.findByRole('heading', { name: 'For your tax advisor' })

    // Then the card goes straight from its heading to the buttons: no note, no icon, no link
    const card = exportCard()
    expect(within(card).queryByRole('list')).not.toBeInTheDocument()
    expect(within(card).queryByRole('link', { name: 'Review them' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Ready to send/)).not.toBeInTheDocument()
  })

  test('basis approved: the note says "not approved" and lists every non-zero "not in these totals" bucket; the VAT line stays last', async () => {
    // Given basis=approved with every bucket non-zero
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

    // Then the first line says "not approved", with the same review link
    expect(await screen.findByText('3 not approved · 4 with warnings')).toBeInTheDocument()
    const card = exportCard()
    expect(within(card).getByRole('link', { name: 'Review them' })).toHaveAttribute(
      'href',
      '/?view=history&year=2026&status=needs_review',
    )
    // And each bucket keeps today's text and link, inside the export card, above the buttons
    const undated = within(card).getByRole('link', { name: '2 receipts have no valid date' })
    expect(undated).toHaveAttribute('href', '/?view=history&year=none')
    expect(within(card).getByText(/1 receipt has no total/)).toBeInTheDocument()
    expect(within(card).getByText(/1 receipt has no currency/)).toBeInTheDocument()
    expect(within(card).getByText(/1 receipt has no apartment/)).toBeInTheDocument()
    const zip = within(card).getByRole('link', { name: /download zip/i })
    expect(undated.compareDocumentPosition(zip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // And the VAT note appears exactly once, as the page's last element
    const vat = screen.getAllByText(
      'Totals are the amounts printed on the receipts, including VAT. Ask your tax advisor how to use them.',
    )
    expect(vat).toHaveLength(1)
    expect(vat[0].nextElementSibling).toBeNull()
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

  test('the export card comes last before the VAT note: ZIP primary, CSV secondary, options folded away, privacy note kept, no "not reviewed" line', async () => {
    // Given a year with unreviewed receipts
    fetchSpy.mockImplementation(
      withApartments(
        routeFetch({
          yearly: () => Promise.resolve(jsonResponse(200, reportResponse({ counted_unreviewed: 3 }))),
        }),
      ),
    )
    await renderReady()

    // Then ZIP is the primary link and CSV the secondary one
    expect(zipLink().className).toMatch(/\bbg-brand\b/)
    expect(csvLink().className).not.toMatch(/\bbg-brand\b/)
    // And the two selects sit in a closed "Export options" <details>
    const options = screen.getByText('Export options').closest('details') as HTMLDetailsElement
    expect(options.open).toBe(false)
    expect(within(options).getByLabelText('Apartment')).toHaveValue('')
    expect(within(options).getByLabelText('CSV format')).toHaveValue('excel_de')
    // And the privacy note stays, the old "not reviewed" note is gone
    expect(
      screen.getByText('The ZIP contains personal data and is not encrypted; send it only to your tax advisor.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Receipts that were not reviewed are included.')).not.toBeInTheDocument()
    // And the export card is the last card on the page (only the VAT note follows)
    const exportHeading = screen.getByRole('heading', { name: 'For your tax advisor' })
    const exportCard = exportHeading.parentElement as HTMLElement
    expect(exportCard.nextElementSibling?.textContent).toMatch(/^Totals are the amounts printed/)
  })

  test('counted_unreviewed = 0 under basis all shows no "not reviewed" line', async () => {
    await renderReady()
    expect(screen.queryByText('Receipts that were not reviewed are included.')).not.toBeInTheDocument()
  })
})
