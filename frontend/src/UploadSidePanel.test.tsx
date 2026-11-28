import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UploadSidePanel, { ReceiptsOverview } from './UploadSidePanel'
import type { ReceiptSummary } from './api/types'
import { jsonResponse } from './test/apartmentsFetch'
import { expectBrowserHandlesModifiedClicks } from './test/linkClicks'

function summary(overrides: Partial<ReceiptSummary>): ReceiptSummary {
  return {
    receipt_id: '11111111-1111-4111-8111-111111111111',
    original_filename: 'a.jpg',
    store_name: 'Edeka',
    purchase_date: '2026-11-20',
    currency: 'EUR',
    total: 23.5,
    created_at: '2026-11-25T10:00:00Z',
    apartment_id: 'sankt-englmar-waldglueck',
    apartment_name: 'Fewo JoJo - Sankt Englmar - Waldglück',
    status: 'needs_review',
    ...overrides,
  }
}

const LATEST: ReceiptSummary[] = [
  summary({}),
  summary({
    receipt_id: '22222222-2222-4222-8222-222222222222',
    store_name: null,
    purchase_date: '26/06/2025',
    total: null,
    apartment_id: null,
    apartment_name: null,
  }),
  summary({ receipt_id: '33333333-3333-4333-8333-333333333333', store_name: 'Rewe', purchase_date: null }),
  summary({ receipt_id: '44444444-4444-4444-8444-444444444444', store_name: 'dm' }),
  summary({ receipt_id: '55555555-5555-4555-8555-555555555555', store_name: 'Aldi' }),
]

let fetchSpy: jest.Mock

type Route = () => Promise<unknown>

/** The panel makes exactly one kind of request now (GET /receipts); any
 * other call -- e.g. the removed facets request -- fails the test. */
function routeFetch({ receipts }: { receipts: Route }) {
  fetchSpy = jest.fn().mockImplementation((url: unknown) => {
    const urlString = String(url)
    if (urlString.includes('/receipts?')) {
      return receipts()
    }
    return Promise.reject(new Error(`Unexpected fetch call to ${urlString}`))
  })
  global.fetch = fetchSpy as unknown as typeof fetch
}

function okReceipts(items: ReceiptSummary[] = LATEST, total = 42): Route {
  return () => Promise.resolve(jsonResponse(200, { items, count: items.length, total }))
}

/** The "Latest uploads" list (the <ul> right after its h2). */
async function latestList(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { level: 2, name: 'Latest uploads' })
  return heading.nextElementSibling as HTMLElement
}

beforeEach(() => {
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
  // @ts-expect-error cleaning up the test-only global fetch stub
  delete global.fetch
})

function callsTo(fragment: string): string[] {
  return fetchSpy.mock.calls.map(([url]) => String(url)).filter((url) => url.includes(fragment))
}

test('while loading, a role="status" aria-busy skeleton card is shown, filling its column (not sticky)', async () => {
  // Given a request that has not answered yet
  routeFetch({ receipts: () => new Promise(() => {}) })

  // When the panel mounts
  render(<UploadSidePanel />)

  // Then a busy status region with the loading text is shown, inside a card
  // with the same outer classes as the loaded variants (no jump): it fills
  // its stretched column from lg up and is no longer sticky
  const status = screen.getByRole('status')
  expect(status).toHaveAttribute('aria-busy', 'true')
  expect(within(status).getByText('Loading your receipts...')).toBeInTheDocument()
  const card = status.parentElement as HTMLElement
  expect(card).toHaveClass('lg:flex-1')
  expect(card.className).not.toContain('lg:sticky')
})

test('on mount it fetches only the 5 latest uploads, once, in upload order (no facets request)', async () => {
  // Given saved receipts
  routeFetch({ receipts: okReceipts() })

  // When the panel mounts
  render(<UploadSidePanel />)
  await latestList()

  // Then exactly one request was made: 5 receipts, sorted by upload time
  expect(fetchSpy).toHaveBeenCalledTimes(1)
  const listCalls = callsTo('/receipts?')
  expect(listCalls).toHaveLength(1)
  expect(new URL(listCalls[0], 'http://x').searchParams.get('limit')).toBe('5')
  expect(new URL(listCalls[0], 'http://x').searchParams.get('sort')).toBe('uploaded_desc')
  expect(callsTo('/receipts/facets')).toHaveLength(0)
})

test('with a total of 0, the help content is shown expanded (no <details>) and no overview', async () => {
  // Given no saved receipts (the list's own total says so)
  routeFetch({ receipts: okReceipts([], 0) })

  // When the panel loads
  render(<UploadSidePanel />)

  // Then today's help is shown, fully expanded
  expect(await screen.findByRole('heading', { level: 2, name: 'How it works' })).toBeInTheDocument()
  expect(screen.getByText('Choose the apartment.')).toBeVisible()
  expect(screen.getByText('Lay the receipt flat.')).toBeVisible()
  expect(document.querySelector('details')).not.toBeInTheDocument()
  expect(screen.queryByText('Latest uploads')).not.toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

test.each([
  ['the receipts request fails', { receipts: () => Promise.resolve(jsonResponse(500, {})) }],
  ['the network is down', { receipts: () => Promise.reject(new TypeError('offline')) }],
])('when %s, it silently falls back to the help (no error shown)', async (_label, routes) => {
  // Given a failing request
  routeFetch(routes)

  // When the panel loads
  render(<UploadSidePanel />)

  // Then the help is shown and nothing looks like an error
  expect(await screen.findByRole('heading', { level: 2, name: 'How it works' })).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByText('Latest uploads')).not.toBeInTheDocument()
})

test('the overview reads top to bottom: "How it works and tips" (open by default), the "Latest uploads" heading and rows, then the two links', async () => {
  // Given saved receipts
  routeFetch({ receipts: okReceipts() })
  render(<UploadSidePanel />)
  const list = await latestList()

  // Then the help is a <details> at the top, open by default, its text present exactly once
  const details = screen.getByText('How it works and tips').closest('details') as HTMLDetailsElement
  expect(details.open).toBe(true)
  expect(screen.getAllByText('Lay the receipt flat.')).toHaveLength(1)
  expect(within(details).getByText('Choose the apartment.')).toBeInTheDocument()

  // And "Latest uploads" is the panel's heading (h2), after the help
  const heading = screen.getByRole('heading', { level: 2, name: 'Latest uploads' })
  expect(details.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

  // And the two links come last, after the rows
  const history = screen.getByRole('link', { name: 'See all in History' })
  const report = screen.getByRole('link', { name: 'Open the yearly report' })
  expect(history).toHaveAttribute('href', '/?view=history')
  expect(report).toHaveAttribute('href', '/?view=report')
  expect(list.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

  // And the removed parts are gone: no "Your receipts", no count, no per-apartment links
  expect(screen.queryByText('Your receipts')).not.toBeInTheDocument()
  expect(screen.queryByText(/receipts? saved/)).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /^(Bergblick|Waldglück): \d+$/ })).not.toBeInTheDocument()
})

test('"Latest uploads" lists the 5 receipts, each linking to ?receipt=<id>, with store, date, amount and apartment', async () => {
  // Given saved receipts
  routeFetch({ receipts: okReceipts() })

  // When the panel loads
  render(<UploadSidePanel />)
  const list = await latestList()

  // Then 5 rows link to their receipts
  const rows = within(list).getAllByRole('link')
  expect(rows).toHaveLength(5)
  expect(rows.map((row) => row.getAttribute('href'))).toEqual(LATEST.map((r) => `/?receipt=${r.receipt_id}`))

  // And the first row shows store (1-line clamp with title), DD.MM.YYYY,
  // amount via formatMoney and the apartment short name
  const first = rows[0]
  const store = within(first).getByText('Edeka')
  expect(store).toHaveAttribute('title', 'Edeka')
  expect(store.className).toContain('line-clamp-1')
  expect(within(first).getByText('20.11.2026')).toBeInTheDocument()
  expect(within(first).getByText('€23.50')).toBeInTheDocument()
  expect(within(first).getByText('Waldglück')).toBeInTheDocument()
})

test('a latest row with missing values shows MissingValue, and an unrecognized date shows the marker', async () => {
  // Given a receipt with no store/total/apartment and a non-ISO date
  routeFetch({ receipts: okReceipts() })

  // When the panel loads
  render(<UploadSidePanel />)
  await latestList()

  // Then that row shows "Not detected" (hidden) for store, amount and
  // apartment, and the raw date with the "Date not recognized" marker
  const second = screen.getByRole('link', { name: /26\/06\/2025/ })
  expect(within(second).getAllByText('Not detected')).toHaveLength(3)
  expect(within(second).getByText('26/06/2025')).toBeInTheDocument()
  expect(within(second).getByText('Date not recognized')).toHaveClass('sr-only')

  // And a missing date also shows MissingValue
  const third = screen.getByRole('link', { name: /Rewe/ })
  expect(within(third).getByText('Not detected')).toBeInTheDocument()
})

test('a plain click on an overview link navigates in-app via the URL', async () => {
  const user = userEvent.setup()
  // Given the loaded overview
  routeFetch({ receipts: okReceipts() })
  render(<UploadSidePanel />)
  await latestList()

  // When the owner clicks "See all in History"
  await user.click(screen.getByRole('link', { name: 'See all in History' }))

  // Then the address bar points at History
  expect(window.location.search).toBe('?view=history')
})

test('changing refreshKey refetches once, keeping the current content (no skeleton) until new data arrives', async () => {
  // Given a loaded overview
  routeFetch({ receipts: okReceipts() })
  const { rerender } = render(<UploadSidePanel refreshKey={0} />)
  await screen.findByText('Edeka')

  // When the refresh key changes and the new latest upload is "Netto"
  let resolveReceipts!: (value: unknown) => void
  routeFetch({ receipts: () => new Promise((resolve) => (resolveReceipts = resolve)) })
  rerender(<UploadSidePanel refreshKey={1} />)

  // Then the old content stays while loading -- no skeleton
  expect(screen.getByText('Edeka')).toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()

  // And once the request answers, the new row is shown
  const fresh = [summary({ receipt_id: '66666666-6666-4666-8666-666666666666', store_name: 'Netto' }), ...LATEST.slice(0, 4)]
  resolveReceipts(jsonResponse(200, { items: fresh, count: 5, total: 43 }))
  expect(await screen.findByText('Netto')).toBeInTheDocument()
  expect(callsTo('/receipts?')).toHaveLength(1)

  // And re-rendering with the same key fetches nothing more
  rerender(<UploadSidePanel refreshKey={1} />)
  await waitFor(() => expect(callsTo('/receipts?')).toHaveLength(1))
})

test('a latest-upload link leaves ctrl/cmd-click to the browser; a plain click still opens it in place', async () => {
  // Given the panel with saved receipts
  routeFetch({ receipts: okReceipts() })
  render(<UploadSidePanel />)
  const first = within(await latestList()).getAllByRole('link')[0]

  // Then modified clicks are not prevented, and a plain click navigates
  expectBrowserHandlesModifiedClicks(first, `?receipt=${LATEST[0].receipt_id}`)
})

test('ReceiptsOverview renders with just the latest uploads (no facets prop)', () => {
  // Given the presentational overview with one receipt
  render(<ReceiptsOverview latest={[summary({})]} />)

  // Then its heading and row are there
  expect(screen.getByRole('heading', { level: 2, name: 'Latest uploads' })).toBeInTheDocument()
  expect(screen.getByText('Edeka')).toBeInTheDocument()
})

test('"How it works and tips" starts open and can still be closed (nothing remembered: a new mount is open again)', async () => {
  // Given the overview with saved receipts
  routeFetch({ receipts: okReceipts() })
  const user = userEvent.setup()
  const { unmount } = render(<UploadSidePanel />)
  await latestList()
  const summary = screen.getByText('How it works and tips').closest('summary') as HTMLElement
  const details = summary.closest('details') as HTMLDetailsElement
  expect(details.open).toBe(true)

  // When the owner closes it
  await user.click(summary)

  // Then it is closed
  expect(details.open).toBe(false)

  // When the panel mounts again (a reload)
  unmount()
  routeFetch({ receipts: okReceipts() })
  render(<UploadSidePanel />)
  await latestList()

  // Then it is open again -- no state is remembered
  expect((screen.getByText('How it works and tips').closest('details') as HTMLDetailsElement).open).toBe(true)
})
