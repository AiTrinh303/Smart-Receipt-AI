import { useEffect, useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { chooseOption, selectControl, selectValue } from './test/select'
import ReceiptReport, { ExportCard, MonthlyCurrencyTable } from './ReceiptReport'
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
    overall_months: [{ month: 1, by_currency: [currencyTotal('EUR', '25.00', 2)] }],
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
      expect(selectValue(selectControl('Year'))).toBe('2026')
    })
    const yearlyCall = fetchSpy.mock.calls.find(([url]) => String(url).includes('/reports/yearly'))!
    expect(String(yearlyCall[0])).toContain('year=2026')
  })

  test('the default request sends no basis param and shows no "Estimates only" text', async () => {
    render(<ReceiptReport />)
    await waitFor(() => {
      expect(selectControl('Year')).toBeInTheDocument()
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
    expect(screen.getByRole('heading', { name: 'Both apartments' })).toBeInTheDocument()
  })

  test('apartment cards are solid in their tone with white text; Both apartments is solid slate-700 with white text', async () => {
    // Given the default report (Bergblick with receipts, Waldglück empty)
    render(<ReceiptReport />)
    const waldglueck = await screen.findByRole('heading', { name: 'Waldglück' })
    const bergblick = screen.getByRole('heading', { name: 'Bergblick' })
    const both = screen.getByRole('heading', { name: 'Both apartments' })

    // Then each card is its tone's main colour, with no border and no dot
    const bergblickCard = bergblick.parentElement as HTMLElement
    expect(bergblickCard).toHaveClass('bg-apartment-sky')
    expect(bergblickCard).not.toHaveClass('border')
    expect(waldglueck.parentElement).toHaveClass('bg-apartment-fuchsia')
    expect(bergblick.querySelector('[aria-hidden="true"]')).toBeNull()
    // And the name and amount are white, the receipt count white at 90%
    expect(bergblick).toHaveClass('text-white')
    expect(within(bergblickCard).getAllByText('€25.00')[0]).toHaveClass('text-white')
    expect(within(bergblickCard).getByText('2 receipts')).toHaveClass('text-white/90')
    // (an empty apartment's message is muted white too)
    expect(within(waldglueck.parentElement as HTMLElement).getByText('No receipts in 2026.')).toHaveClass('text-white/90')
    // And "Both apartments" is solid slate-700 with the same white text
    const bothCard = both.parentElement as HTMLElement
    expect(bothCard).toHaveClass('bg-slate-700')
    expect(both).toHaveClass('text-white')
    expect(within(bothCard).getByText('2 receipts')).toHaveClass('text-white/90')
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

    // Then its card is the plain white one, with ink text
    const heading = await screen.findByRole('heading', { name: 'Elsewhere' })
    expect(heading.parentElement).toHaveClass('bg-surface', 'border-border-subtle')
    expect(heading).toHaveClass('text-ink')
  })

  test('no basis toggle: the description always says every saved receipt counts; a basis param in the URL is ignored and dropped', async () => {
    // Given an old bookmark with basis=approved
    window.history.replaceState({}, '', '/?view=report&year=2026&basis=approved')
    const calls: string[] = []
    fetchSpy.mockImplementation(
      routeFetch({
        yearly: (urlString) => {
          calls.push(urlString)
          return Promise.resolve(jsonResponse(200, reportResponse()))
        },
      }),
    )
    render(<ReceiptReport />)
    await screen.findByRole('heading', { name: 'Bergblick' })

    // Then the page uses the default basis: the request has no basis, the description is the "all" one
    expect(calls).toHaveLength(1)
    expect(calls[0]).not.toContain('basis=')
    expect(screen.getByText('Spending per apartment, from every saved receipt.')).toBeInTheDocument()
    expect(screen.queryByText('Spending per apartment, from the receipts you approved.')).not.toBeInTheDocument()
    // And the param is dropped from the address bar, the year kept
    expect(window.location.search).toBe('?view=report&year=2026')
    // And there is no "Only count receipts I approved" checkbox
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByText('Only count receipts I approved')).not.toBeInTheDocument()
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

  test('an apartment with no data shows "No receipts in <year>."', async () => {
    render(<ReceiptReport />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Waldglück' })).toBeInTheDocument()
    })
    expect(screen.getByText('No receipts in 2026.')).toBeInTheDocument()
  })

  test('"Show by month" is a text-style disclosure (rotating chevron), open by default, right under the summary cards', async () => {
    render(<ReceiptReport />)
    const summaryText = await screen.findByText('Show by month')

    // Then it's a <details>, open by default, placed directly after the summary cards
    const details = summaryText.closest('details') as HTMLDetailsElement
    expect(details.open).toBe(true)
    expect(details).toHaveClass('group')
    expect(details.previousElementSibling).toContainElement(screen.getByRole('heading', { name: 'Both apartments' }))
    // And its summary is the same text-style control as "How it works and tips": no marker, a chevron that
    // rotates open, a visible focus ring
    const summary = details.querySelector('summary') as HTMLElement
    expect(summary).toHaveClass('list-none', 'font-medium', 'text-ink', 'focus-visible:outline-brand')
    const chevron = summary.querySelector('svg') as SVGElement
    expect(chevron).toHaveAttribute('aria-hidden', 'true')
    expect(chevron).toHaveClass('group-open:rotate-90')
  })

  test('"Show by month" starts open and can still be closed; a new mount (reload) is open again', async () => {
    // Given the report
    const user = userEvent.setup()
    const { unmount } = render(<ReceiptReport />)
    const summary = (await screen.findByText('Show by month')).closest('summary') as HTMLElement
    const details = summary.closest('details') as HTMLDetailsElement
    expect(details.open).toBe(true)

    // When the owner closes it
    await user.click(summary)

    // Then it is closed
    expect(details.open).toBe(false)

    // When the page mounts again (a reload)
    unmount()
    render(<ReceiptReport />)

    // Then it is open again -- no state is remembered
    const again = (await screen.findByText('Show by month')).closest('details') as HTMLDetailsElement
    expect(again.open).toBe(true)
  })

  test('the monthly table: a full-width table-fixed table in a Card, four equal columns (Month, each apartment with its dot, Both apartments), right-aligned € amounts, muted dash and empty months, and a Total row from the summary', async () => {
    // Given Bergblick with January and March data, Waldglück empty, and the backend's overall/overall_months
    fetchSpy.mockImplementation(
      routeFetch({
        yearly: () =>
          Promise.resolve(
            jsonResponse(
              200,
              reportResponse({
                apartments: [
                  apartmentSummary({
                    by_currency: [currencyTotal('EUR', '25.00', 2)],
                    months: [
                      { month: 1, by_currency: [currencyTotal('EUR', '10.00', 1)] },
                      { month: 3, by_currency: [currencyTotal('EUR', '15.00', 1)] },
                    ],
                  }),
                  apartmentSummary({ apartment_id: WALDGLUECK.id, apartment_name: WALDGLUECK.name, by_currency: [], months: [] }),
                ],
                overall: [currencyTotal('EUR', '25.00', 2)],
                overall_months: [
                  { month: 1, by_currency: [currencyTotal('EUR', '10.00', 1)] },
                  { month: 3, by_currency: [currencyTotal('EUR', '15.00', 1)] },
                ],
              }),
            ),
          ),
      }),
    )
    render(<ReceiptReport />)
    const details = (await screen.findByText('Show by month')).closest('details') as HTMLDetailsElement

    // Then the table sits in a Card
    const table = within(details).getByRole('table')
    expect(table.closest('.rounded-card')).toHaveClass('shadow-card')
    // And it fills the card with four equal columns (Month, two apartments, Both): 25% each
    expect(table).toHaveClass('w-full', 'table-fixed')
    const cols = Array.from(table.querySelectorAll('colgroup > col')) as HTMLElement[]
    expect(cols.map((col) => col.style.width)).toEqual(['25%', '25%', '25%', '25%'])
    // And the header is Month, one column per apartment with its tone dot, then "Both apartments" (no dot)
    const headers = within(table).getAllByRole('columnheader')
    expect(headers.map((th) => th.textContent)).toEqual(['Month', 'Bergblick', 'Waldglück', 'Both apartments'])
    for (const th of headers.slice(1)) {
      expect(th).toHaveClass('text-right')
      expect(th.className).not.toMatch(/\bw-\d/)
    }
    for (const th of headers.slice(1, 3)) {
      expect(th.querySelector('span[aria-hidden="true"].rounded-full')).not.toBeNull()
    }
    expect(headers[3].querySelector('.rounded-full')).toBeNull()

    // And every month January..December is a row, then Total
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((row) => row.firstElementChild?.textContent)).toEqual([
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December', 'Total',
    ])
    // And amounts carry €, right-aligned, tabular, fixed width
    const marchBergblick = rows[2].children[1] as HTMLElement
    expect(marchBergblick).toHaveTextContent('€15.00')
    expect(marchBergblick).toHaveClass('text-right', 'tabular-nums')
    // And an empty cell is a muted dash (read as "No receipts")
    const marchWaldglueck = rows[2].children[2] as HTMLElement
    expect(marchWaldglueck.querySelector('.text-ink-muted')).toHaveTextContent('—')
    expect(marchWaldglueck).toHaveTextContent('No receipts')
    // And a month with no data in any column is muted; one with data is not
    expect(rows[1]).toHaveClass('text-ink-muted')
    expect(rows[2]).toHaveClass('text-ink')
    // And the Both column shows overall_months, right-aligned and tabular
    const marchBoth = rows[2].children[3] as HTMLElement
    expect(marchBoth).toHaveTextContent('€15.00')
    expect(marchBoth).toHaveClass('text-right', 'tabular-nums')
    expect(rows[1].children[3]).toHaveTextContent('—')
    // And the Total row (semibold, top border) shows the summary totals and overall as given
    const total = rows[12]
    expect(total).toHaveClass('font-semibold', 'border-t')
    expect(total.children[1]).toHaveTextContent('€25.00')
    expect(total.children[2]).toHaveTextContent('—')
    expect(total.children[3]).toHaveTextContent('€25.00')
    expect(within(details).queryByRole('heading', { name: '€' })).not.toBeInTheDocument()
  })

  test('the Total row is taken from the summary totals, never summed from the months', async () => {
    // Given a summary total that is deliberately NOT the sum of the months (10.00 + 15.00)
    fetchSpy.mockImplementation(
      routeFetch({
        yearly: () =>
          Promise.resolve(
            jsonResponse(
              200,
              reportResponse({
                apartments: [
                  apartmentSummary({
                    by_currency: [currencyTotal('EUR', '99.99', 2)],
                    months: [
                      { month: 1, by_currency: [currencyTotal('EUR', '10.00', 1)] },
                      { month: 3, by_currency: [currencyTotal('EUR', '15.00', 1)] },
                    ],
                  }),
                ],
              }),
            ),
          ),
      }),
    )
    render(<ReceiptReport />)
    const details = (await screen.findByText('Show by month')).closest('details') as HTMLDetailsElement

    // Then the apartment's Total shows the summary card's number, not 25.00
    const rows = within(within(details).getByRole('table')).getAllByRole('row')
    const total = rows[rows.length - 1]
    expect(total.children[1]).toHaveTextContent('€99.99')
    expect(total.children[1]).not.toHaveTextContent('25.00')
  })

  test('the Both column shows what the backend sent (overall_months / overall), never adds the apartments up', async () => {
    // Given Both values that deliberately are NOT the apartments added up
    fetchSpy.mockImplementation(
      routeFetch({
        yearly: () =>
          Promise.resolve(
            jsonResponse(
              200,
              reportResponse({
                apartments: [
                  apartmentSummary({
                    by_currency: [currencyTotal('EUR', '10.00', 1)],
                    months: [{ month: 2, by_currency: [currencyTotal('EUR', '10.00', 1)] }],
                  }),
                  apartmentSummary({
                    apartment_id: WALDGLUECK.id,
                    apartment_name: WALDGLUECK.name,
                    by_currency: [currencyTotal('EUR', '5.00', 1)],
                    months: [{ month: 2, by_currency: [currencyTotal('EUR', '5.00', 1)] }],
                  }),
                ],
                overall: [currencyTotal('EUR', '77.77', 2)],
                overall_months: [{ month: 2, by_currency: [currencyTotal('EUR', '66.66', 2)] }],
              }),
            ),
          ),
      }),
    )
    render(<ReceiptReport />)
    const details = (await screen.findByText('Show by month')).closest('details') as HTMLDetailsElement

    // Then February's Both cell and the Total's Both cell are the backend's numbers, not 15.00
    const rows = within(within(details).getByRole('table')).getAllByRole('row')
    expect(rows[2].children[3]).toHaveTextContent('€66.66')
    expect(rows[rows.length - 1].children[3]).toHaveTextContent('€77.77')
    expect(within(details).queryByText('€15.00')).not.toBeInTheDocument()
  })

  test.each([
    [2, ['25%', '25%', '25%', '25%']],
    [3, ['20%', '20%', '20%', '20%', '20%']],
  ])('with %i apartments and the Both column every column gets an equal share adding up to 100%%', (count, expected) => {
    // Given a monthly table with that many apartments plus Both
    const apartments = Array.from({ length: count }, (_, index) =>
      apartmentSummary({ apartment_id: `apartment-${index}`, apartment_name: `Apartment ${index}`, months: [] }),
    )
    render(
      <MonthlyCurrencyTable
        currency="EUR"
        months={[1]}
        cells={{}}
        apartments={apartments}
        isSmallScreen={false}
        showCurrencyHeading={false}
        both={{ months: {}, total: undefined }}
      />,
    )

    // Then all columns are equal and add up to 100%
    const cols = Array.from(screen.getByRole('table').querySelectorAll('colgroup > col')) as HTMLElement[]
    expect(cols.map((col) => col.style.width)).toEqual(expected)
    expect(cols.reduce((sum, col) => sum + parseFloat(col.style.width), 0)).toBeCloseTo(100)
  })

  test.each([
    [1, ['40%', '60%']],
    [3, ['40%', '20%', '20%', '20%']],
  ])('without a Both column, with %i apartment column(s), Month keeps 40%% and the widths add up to 100%%', (count, expected) => {
    // Given a monthly table with that many apartments
    const apartments = Array.from({ length: count }, (_, index) =>
      apartmentSummary({ apartment_id: `apartment-${index}`, apartment_name: `Apartment ${index}`, months: [] }),
    )
    render(
      <MonthlyCurrencyTable
        currency="EUR"
        months={[1]}
        cells={{}}
        apartments={apartments}
        isSmallScreen={false}
        showCurrencyHeading={false}
      />,
    )

    // Then Month keeps 40% and the apartments share the rest equally
    const cols = Array.from(screen.getByRole('table').querySelectorAll('colgroup > col')) as HTMLElement[]
    expect(cols.map((col) => col.style.width)).toEqual(expected)
    expect(cols.reduce((sum, col) => sum + parseFloat(col.style.width), 0)).toBeCloseTo(100)
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
      expect(selectValue(selectControl('Year'))).toBe('2026')
    })

    await chooseOption(user, 'Year', '2025')

    await waitFor(() => expect(window.location.search).toContain('year=2025'))
    expect(calls[calls.length - 1]).toContain('year=2025')
  })

  test('the Year select is the shared Select in the page header, right of the title, at a fixed width', async () => {
    render(<ReceiptReport />)
    await screen.findByRole('heading', { name: 'Bergblick' })

    // Then the combobox sits in the PageHeader next to the h1, inside a w-40 wrapper
    const control = selectControl('Year')
    const header = screen.getByRole('heading', { level: 1, name: 'Yearly report' }).parentElement?.parentElement as HTMLElement
    expect(header).toContainElement(control)
    expect(control.closest('.w-40')).not.toBeNull()
    // And it offers the same years
    expect(selectValue(control)).toBe('2026')
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

  test('the note says "N not reviewed" and lists every non-zero "not in these totals" bucket; the VAT line stays last', async () => {
    // Given every bucket non-zero
    fetchSpy.mockImplementation(
      routeFetch({
        yearly: () =>
          Promise.resolve(
            jsonResponse(
              200,
              reportResponse({
                counted_unreviewed: 3,
                excluded: { undated: 2, not_approved: 0, no_total: 1, no_currency: 1, no_apartment: 1 },
                with_warnings: 4,
              }),
            ),
          ),
      }),
    )
    render(<ReceiptReport />)

    // Then the first line says "not reviewed", with the review link
    expect(await screen.findByText('3 not reviewed · 4 with warnings')).toBeInTheDocument()
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

  test('excluded.not_approved is never shown (the page always uses basis all), even if it were somehow nonzero', async () => {
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
      expect(screen.getByRole('heading', { name: 'Both apartments' })).toBeInTheDocument()
    })
    expect(screen.queryByText(/are not approved yet/)).not.toBeInTheDocument()
    expect(screen.queryByText(/not approved/)).not.toBeInTheDocument()
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
    await waitFor(() => expect(selectControl('Year')).toBeInTheDocument())
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
      expect(selectControl('Year')).toBeInTheDocument()
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
    expect(screen.queryByRole('combobox', { name: 'Year' })).not.toBeInTheDocument()
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
      expect(selectControl('Year')).toBeInTheDocument()
    })

    // And only then does the older, now-stale request resolve
    olderYears.resolve(jsonResponse(200, { items: [] }))

    // Then the stale response never overwrites the newer, already-shown result
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(selectControl('Year')).toBeInTheDocument()
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

  test('small screen (matchMedia matches): monthly cards render, not a table -- with € amounts and a Total card at the end', async () => {
    mockMatchMedia(true)
    render(<ReceiptReport />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Bergblick' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    // Then 12 month cards plus a Total card, amounts with €
    const details = screen.getByText('Show by month').closest('details') as HTMLDetailsElement
    const cards = within(details).getAllByRole('listitem')
    expect(cards).toHaveLength(13)
    expect(cards[0]).toHaveTextContent('January')
    expect(cards[0]).toHaveTextContent('€25.00')
    expect(cards[1]).toHaveClass('text-ink-muted')
    expect(cards[12]).toHaveTextContent('Total')
    expect(cards[12]).toHaveClass('font-semibold')
    expect(cards[12]).toHaveTextContent('€25.00')
    // And every card has a "Both apartments" line (January's from overall_months, the Total's from overall)
    expect(within(cards[0]).getByText('Both apartments').nextElementSibling).toHaveTextContent('€25.00')
    expect(within(cards[12]).getByText('Both apartments').nextElementSibling).toHaveTextContent('€25.00')
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
      expect(selectValue(selectControl('Year'))).toBe('2026')
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
    expect(screen.getByText('2026 · All apartments · German Excel')).toBeInTheDocument()
  })

  test('changing the year updates both hrefs', async () => {
    await renderReady()
    await chooseOption(userEvent.setup(), 'Year', '2025')
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

  test('a basis param in the URL never reaches the export links', async () => {
    // Given an old bookmark with basis=approved
    window.history.replaceState({}, '', '/?view=report&year=2026&basis=approved')
    await renderReady()

    // Then the links carry no basis, and there is no checkbox to switch it
    expect(zipLink()).toHaveAttribute('href', `${API_URL}/reports/yearly/export.zip?year=2026&style=excel_de`)
    expect(csvLink()).toHaveAttribute('href', `${API_URL}/reports/yearly/export.csv?year=2026&style=excel_de`)
    expect(screen.getByText('2026 · All apartments · German Excel')).toBeInTheDocument()
    expect(screen.queryByText(/approved receipts only/)).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  test('choosing an apartment adds apartment_id to both hrefs and the summary follows', async () => {
    // Given the export card with its defaults (All apartments)
    await renderReady()
    const user = userEvent.setup()
    expect(screen.getByRole('radio', { name: 'All apartments' })).toBeChecked()

    // When an apartment is chosen
    await user.click(screen.getByRole('radio', { name: SAMPLE_APARTMENTS[0].name }))

    // Then both hrefs carry its id, exactly as before, and the summary names it
    expect(zipLink()).toHaveAttribute(
      'href',
      `${API_URL}/reports/yearly/export.zip?year=2026&style=excel_de&apartment_id=${SAMPLE_APARTMENTS[0].id}`,
    )
    expect(csvLink()).toHaveAttribute(
      'href',
      `${API_URL}/reports/yearly/export.csv?year=2026&style=excel_de&apartment_id=${SAMPLE_APARTMENTS[0].id}`,
    )
    expect(screen.getByText(`2026 · ${SAMPLE_APARTMENTS[0].name} · German Excel`)).toBeInTheDocument()

    // When All apartments is chosen again
    await user.click(screen.getByRole('radio', { name: 'All apartments' }))

    // Then apartment_id is gone again
    expect(zipLink()).toHaveAttribute('href', `${API_URL}/reports/yearly/export.zip?year=2026&style=excel_de`)
  })

  test('choosing the plain format sends style=plain; the default sends style=excel_de; the summary follows', async () => {
    // Given the default German Excel choice
    await renderReady()
    expect(screen.getByRole('radio', { name: 'German Excel' })).toBeChecked()
    expect(zipLink()).toHaveAttribute('href', expect.stringContaining('style=excel_de'))

    // When Plain CSV is chosen
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Plain CSV' }))

    // Then both links send style=plain and the summary says so
    expect(zipLink()).toHaveAttribute('href', expect.stringContaining('style=plain'))
    expect(csvLink()).toHaveAttribute('href', expect.stringContaining('style=plain'))
    expect(screen.getByText('2026 · All apartments · Plain CSV')).toBeInTheDocument()
  })

  test('no fetch is ever made for the export links -- only /reports/years and /reports/yearly and /apartments', async () => {
    await renderReady()
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: 'Plain CSV' }))
    await user.click(screen.getByRole('radio', { name: SAMPLE_APARTMENTS[0].name }))
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

  test('the export card comes last before the VAT note: ZIP primary, CSV secondary, the choices visible above the buttons, privacy note kept, no "not reviewed" line', async () => {
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
    // And there is no "Export options" <details> any more: both groups are visible, with their defaults,
    // between the open-items note and the buttons
    expect(screen.queryByText('Export options')).not.toBeInTheDocument()
    const apartmentGroup = screen.getByRole('radiogroup', { name: 'Apartment' })
    const styleGroup = screen.getByRole('radiogroup', { name: 'CSV format' })
    expect(apartmentGroup.closest('details')).toBeNull()
    expect(within(apartmentGroup).getByRole('radio', { name: 'All apartments' })).toBeChecked()
    expect(within(styleGroup).getByRole('radio', { name: 'German Excel' })).toBeChecked()
    const note = screen.getByText(/3 not reviewed/)
    expect(note.compareDocumentPosition(apartmentGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(styleGroup.compareDocumentPosition(zipLink()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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

  test('the apartment group: All apartments / Both, then each apartment with its dot, short name and its place as a muted second line, full name as accessible name/title', () => {
    // Given the real-style apartment names
    render(
      <ExportCard
        year={2026}
        apartments={[
          { id: 'oberaudorf-bergblick', name: 'Fewo JoJo - Oberaudorf - Bergblick' },
          { id: 'sankt-englmar-waldglueck', name: 'Fewo JoJo - Sankt Englmar - Waldglück' },
        ]}
      />,
    )

    // Then the group's visible legend is "Apartment" and the options come in order
    const group = screen.getByRole('radiogroup', { name: 'Apartment' })
    expect(within(group).getByText('Apartment').tagName).toBe('LEGEND')
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((radio) => radio.getAttribute('aria-label'))).toEqual([
      'All apartments',
      'Fewo JoJo - Oberaudorf - Bergblick',
      'Fewo JoJo - Sankt Englmar - Waldglück',
    ])
    // And an apartment shows its short name, its place as a muted second line and a tone dot,
    // with the full name as title
    const bergblick = radios[1].closest('label') as HTMLElement
    expect(bergblick).toHaveTextContent('Bergblick')
    expect(within(bergblick).getByText('Oberaudorf')).toHaveClass('text-xs', 'text-ink-muted')
    expect(bergblick).not.toHaveTextContent('Fewo JoJo')
    expect(bergblick).toHaveAttribute('title', 'Fewo JoJo - Oberaudorf - Bergblick')
    expect(bergblick.querySelector('span[aria-hidden="true"].rounded-full')).not.toBeNull()
    const waldglueck = radios[2].closest('label') as HTMLElement
    expect(within(waldglueck).getByText('Sankt Englmar')).toHaveClass('text-ink-muted')
    // And "All apartments" has no dot and "Both" as its second line
    const all = radios[0].closest('label') as HTMLElement
    expect(all.querySelector('.rounded-full')).toBeNull()
    expect(within(all).getByText('Both')).toHaveClass('text-xs', 'text-ink-muted')
    // And the radios share one name (native arrow-key movement)
    expect(new Set(radios.map((radio) => radio.getAttribute('name')))).toEqual(new Set(['report-export-apartment']))
  })

  test('the summary uses the short apartment name: "2026 · Waldglück · Plain CSV"', async () => {
    // Given the real-style apartment names
    const user = userEvent.setup()
    render(
      <ExportCard
        year={2026}
        apartments={[
          { id: 'oberaudorf-bergblick', name: 'Fewo JoJo - Oberaudorf - Bergblick' },
          { id: 'sankt-englmar-waldglueck', name: 'Fewo JoJo - Sankt Englmar - Waldglück' },
        ]}
      />,
    )
    expect(screen.getByText('2026 · All apartments · German Excel')).toBeInTheDocument()

    // When Waldglück and Plain CSV are chosen
    await user.click(screen.getByRole('radio', { name: 'Fewo JoJo - Sankt Englmar - Waldglück' }))
    await user.click(screen.getByRole('radio', { name: 'Plain CSV' }))

    // Then the summary follows both choices, with the short name
    expect(screen.getByText('2026 · Waldglück · Plain CSV')).toBeInTheDocument()
  })

  test('the CSV format group: German Excel and Plain CSV, each with a muted second line; arrow keys move like native radios', async () => {
    render(<ExportCard year={2026} apartments={[]} />)

    // Then each option shows its label and a muted second line
    const group = screen.getByRole('radiogroup', { name: 'CSV format' })
    const excel = within(group).getByRole('radio', { name: 'German Excel' }).closest('label') as HTMLElement
    const plain = within(group).getByRole('radio', { name: 'Plain CSV' }).closest('label') as HTMLElement
    expect(within(excel).getByText('semicolon, decimal comma')).toHaveClass('text-xs', 'text-ink-muted')
    expect(within(plain).getByText('comma, decimal point')).toHaveClass('text-xs', 'text-ink-muted')
    // And the options are the grid's fixed size (see the alignment test)
    expect(excel).toHaveClass('h-14', 'sm:w-48')
    // And the values are the same excel_de / plain as before
    expect(within(group).getByRole('radio', { name: 'German Excel' })).toHaveAttribute('value', 'excel_de')
    expect(within(group).getByRole('radio', { name: 'Plain CSV' })).toHaveAttribute('value', 'plain')

    // When the checked radio gets focus and ArrowRight is pressed
    const user = userEvent.setup()
    within(group).getByRole('radio', { name: 'German Excel' }).focus()
    await user.keyboard('{ArrowRight}')

    // Then Plain CSV is chosen, like a native radio group
    expect(within(group).getByRole('radio', { name: 'Plain CSV' })).toBeChecked()
    expect(screen.getByText('2026 · All apartments · Plain CSV')).toBeInTheDocument()
  })

  test('aligned grid: legends above their groups, every option in both groups the same width and height', () => {
    // Given the export card with real-style apartment names
    render(
      <ExportCard
        year={2026}
        apartments={[
          { id: 'oberaudorf-bergblick', name: 'Fewo JoJo - Oberaudorf - Bergblick' },
          { id: 'sankt-englmar-waldglueck', name: 'Fewo JoJo - Sankt Englmar - Waldglück' },
        ]}
      />,
    )

    // Then each legend is a regular label above its group (not floated beside it)
    for (const name of ['Apartment', 'CSV format']) {
      const legend = within(screen.getByRole('radiogroup', { name })).getByText(name)
      expect(legend.tagName).toBe('LEGEND')
      expect(legend).toHaveClass('text-sm', 'font-medium', 'text-ink')
      expect(legend.className).not.toMatch(/float-left/)
    }
    // And all five options (3 apartment + 2 format) share one size: full width and stacked below sm,
    // w-48 from sm, a fixed h-14 (>= 44px) everywhere -- so "All apartments" sits above "German Excel"
    const options = screen.getAllByRole('radio').map((radio) => radio.closest('label') as HTMLElement)
    expect(options).toHaveLength(5)
    for (const option of options) {
      expect(option).toHaveClass('w-full', 'sm:w-48', 'h-14')
    }
    for (const name of ['Apartment', 'CSV format']) {
      const row = screen.getAllByRole('radio', { name: name === 'Apartment' ? 'All apartments' : 'German Excel' })[0]
        .closest('label')?.parentElement as HTMLElement
      expect(row).toHaveClass('flex-col', 'sm:flex-row', 'sm:flex-wrap', 'gap-2')
    }
  })

  test('counted_unreviewed = 0 under basis all shows no "not reviewed" line', async () => {
    await renderReady()
    expect(screen.queryByText('Receipts that were not reviewed are included.')).not.toBeInTheDocument()
  })
})
