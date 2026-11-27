import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UploadSidePanel, { ReceiptsOverview } from './UploadSidePanel'
import type { ReceiptFacets, ReceiptSummary } from './api/types'
import { jsonResponse } from './test/apartmentsFetch'
import { expectBrowserHandlesModifiedClicks } from './test/linkClicks'

const FACETS: ReceiptFacets = {
  apartments: [
    { id: 'oberaudorf-bergblick', name: 'Fewo JoJo - Oberaudorf - Bergblick', count: 12 },
    { id: 'sankt-englmar-waldglueck', name: 'Fewo JoJo - Sankt Englmar - Waldglück', count: 30 },
  ],
  total: 42,
  years: [2026],
  has_undated: true,
}

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

function routeFetch({ facets, receipts }: { facets: Route; receipts: Route }) {
  fetchSpy = jest.fn().mockImplementation((url: unknown) => {
    const urlString = String(url)
    if (urlString.includes('/receipts/facets')) {
      return facets()
    }
    if (urlString.includes('/receipts?')) {
      return receipts()
    }
    return Promise.reject(new Error(`Unexpected fetch call to ${urlString}`))
  })
  global.fetch = fetchSpy as unknown as typeof fetch
}

function okFacets(body: ReceiptFacets = FACETS): Route {
  return () => Promise.resolve(jsonResponse(200, body))
}

function okReceipts(items: ReceiptSummary[] = LATEST): Route {
  return () => Promise.resolve(jsonResponse(200, { items, count: items.length, total: 42 }))
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

test('while loading, a role="status" aria-busy skeleton card is shown', async () => {
  // Given requests that have not answered yet
  routeFetch({ facets: () => new Promise(() => {}), receipts: () => new Promise(() => {}) })

  // When the panel mounts
  render(<UploadSidePanel />)

  // Then a busy status region with the loading text is shown, inside a
  // sticky card (same outer classes as the loaded variants -- no jump)
  const status = screen.getByRole('status')
  expect(status).toHaveAttribute('aria-busy', 'true')
  expect(within(status).getByText('Loading your receipts...')).toBeInTheDocument()
  expect((status.parentElement as HTMLElement).className).toContain('lg:sticky')
})

test('on mount it fetches the unscoped facets and the 5 latest receipts, once each', async () => {
  // Given both requests succeed
  routeFetch({ facets: okFacets(), receipts: okReceipts() })

  // When the panel mounts
  render(<UploadSidePanel />)
  await screen.findByRole('heading', { level: 2, name: 'Your receipts' })

  // Then exactly one request each was made
  expect(callsTo('/receipts/facets')).toEqual([expect.stringMatching(/\/receipts\/facets$/)])
  const listCalls = callsTo('/receipts?')
  expect(listCalls).toHaveLength(1)
  expect(new URL(listCalls[0], 'http://x').searchParams.get('limit')).toBe('5')
  // And "Latest uploads" asks for upload order explicitly, not the list's date default
  expect(new URL(listCalls[0], 'http://x').searchParams.get('sort')).toBe('uploaded_desc')
})

test('with a total of 0, the help content is shown expanded (no <details>) and no overview', async () => {
  // Given no saved receipts
  routeFetch({
    facets: okFacets({ apartments: [], total: 0, years: [], has_undated: false }),
    receipts: okReceipts([]),
  })

  // When the panel loads
  render(<UploadSidePanel />)

  // Then today's help is shown, fully expanded
  expect(await screen.findByRole('heading', { level: 2, name: 'How it works' })).toBeInTheDocument()
  expect(screen.getByText('Choose the apartment.')).toBeVisible()
  expect(screen.getByText('Lay the receipt flat.')).toBeVisible()
  expect(document.querySelector('details')).not.toBeInTheDocument()
  expect(screen.queryByText('Your receipts')).not.toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

test.each([
  ['the facets request fails', { facets: () => Promise.resolve(jsonResponse(500, {})), receipts: okReceipts() }],
  ['the receipts request fails', { facets: okFacets(), receipts: () => Promise.resolve(jsonResponse(500, {})) }],
  ['the network is down', { facets: () => Promise.reject(new TypeError('offline')), receipts: okReceipts() }],
])('when %s, it silently falls back to the help (no error shown)', async (_label, routes) => {
  // Given a failing request
  routeFetch(routes)

  // When the panel loads
  render(<UploadSidePanel />)

  // Then the help is shown and nothing looks like an error
  expect(await screen.findByRole('heading', { level: 2, name: 'How it works' })).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByText('Your receipts')).not.toBeInTheDocument()
})

test('the overview shows the total and one link per apartment to its History tab', async () => {
  // Given saved receipts
  routeFetch({ facets: okFacets(), receipts: okReceipts() })

  // When the panel loads
  render(<UploadSidePanel />)
  await screen.findByRole('heading', { level: 2, name: 'Your receipts' })

  // Then the total and per-apartment counts are shown, short name visible,
  // full name in title, linking to that apartment's History tab
  expect(screen.getByText('42 receipts saved')).toBeInTheDocument()
  const bergblick = screen.getByRole('link', { name: 'Bergblick: 12' })
  expect(bergblick).toHaveAttribute('href', '/?view=history&apartment=oberaudorf-bergblick')
  expect(bergblick).toHaveAttribute('title', 'Fewo JoJo - Oberaudorf - Bergblick')
  expect(screen.getByRole('link', { name: 'Waldglück: 30' })).toHaveAttribute(
    'href',
    '/?view=history&apartment=sankt-englmar-waldglueck',
  )
})

test('a total of exactly 1 reads "1 receipt saved"', () => {
  // Given a one-receipt overview
  render(<ReceiptsOverview facets={{ ...FACETS, total: 1 }} latest={[summary({})]} />)

  // Then the singular is used
  expect(screen.getByText('1 receipt saved')).toBeInTheDocument()
})

test('"Latest uploads" lists the 5 receipts, each linking to ?receipt=<id>, with store, date, amount and apartment', async () => {
  // Given saved receipts
  routeFetch({ facets: okFacets(), receipts: okReceipts() })

  // When the panel loads
  render(<UploadSidePanel />)
  await screen.findByRole('heading', { level: 3, name: 'Latest uploads' })

  // Then 5 rows link to their receipts
  const list = screen.getByRole('heading', { level: 3, name: 'Latest uploads' }).nextElementSibling as HTMLElement
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
  routeFetch({ facets: okFacets(), receipts: okReceipts() })

  // When the panel loads
  render(<UploadSidePanel />)
  await screen.findByRole('heading', { level: 3, name: 'Latest uploads' })

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

test('the overview links to History and the yearly report, with the help collapsed in a <details>', async () => {
  // Given saved receipts
  routeFetch({ facets: okFacets(), receipts: okReceipts() })

  // When the panel loads
  render(<UploadSidePanel />)
  await screen.findByRole('heading', { level: 2, name: 'Your receipts' })

  // Then both links are there
  expect(screen.getByRole('link', { name: 'See all in History' })).toHaveAttribute('href', '/?view=history')
  expect(screen.getByRole('link', { name: 'Open the yearly report' })).toHaveAttribute('href', '/?view=report')

  // And the help sits in a closed <details>, text present exactly once
  const summaryEl = screen.getByText('How it works and tips').closest('summary') as HTMLElement
  const details = summaryEl.closest('details') as HTMLDetailsElement
  expect(details.open).toBe(false)
  expect(screen.getAllByText('Lay the receipt flat.')).toHaveLength(1)
  expect(within(details).getByText('Choose the apartment.')).toBeInTheDocument()
})

test('a plain click on an overview link navigates in-app via the URL', async () => {
  const user = userEvent.setup()
  // Given the loaded overview
  routeFetch({ facets: okFacets(), receipts: okReceipts() })
  render(<UploadSidePanel />)
  await screen.findByRole('heading', { level: 2, name: 'Your receipts' })

  // When the owner clicks the Waldglück count
  await user.click(screen.getByRole('link', { name: 'Waldglück: 30' }))

  // Then the address bar points at that History tab
  expect(window.location.search).toBe('?view=history&apartment=sankt-englmar-waldglueck')
})

test('changing refreshKey refetches once, keeping the current content (no skeleton) until new data arrives', async () => {
  // Given a loaded overview
  routeFetch({ facets: okFacets(), receipts: okReceipts() })
  const { rerender } = render(<UploadSidePanel refreshKey={0} />)
  await screen.findByText('42 receipts saved')

  // When the refresh key changes and the new data has 43 receipts
  let resolveFacets!: (value: unknown) => void
  routeFetch({
    facets: () => new Promise((resolve) => (resolveFacets = resolve)),
    receipts: okReceipts(),
  })
  rerender(<UploadSidePanel refreshKey={1} />)

  // Then the old content stays while loading -- no skeleton
  expect(screen.getByText('42 receipts saved')).toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()

  // And once the request answers, the new total is shown
  resolveFacets(jsonResponse(200, { ...FACETS, total: 43 }))
  expect(await screen.findByText('43 receipts saved')).toBeInTheDocument()
  expect(callsTo('/receipts/facets')).toHaveLength(1)

  // And re-rendering with the same key fetches nothing more
  rerender(<UploadSidePanel refreshKey={1} />)
  await waitFor(() => expect(callsTo('/receipts/facets')).toHaveLength(1))
})

test('a latest-upload link leaves ctrl/cmd-click to the browser; a plain click still opens it in place', async () => {
  // Given the panel with saved receipts
  routeFetch({ facets: okFacets(), receipts: okReceipts() })
  render(<UploadSidePanel />)
  const list = (await screen.findByRole('heading', { level: 3, name: 'Latest uploads' })).nextElementSibling as HTMLElement
  const first = within(list).getAllByRole('link')[0]

  // Then modified clicks are not prevented, and a plain click navigates
  expectBrowserHandlesModifiedClicks(first, `?receipt=${LATEST[0].receipt_id}`)
})
