import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReceiptUpload from './ReceiptUpload'
import { mockObjectUrl } from './test/objectUrl'
import { SAMPLE_APARTMENTS, clearApartmentsCache, jsonResponse, withApartments } from './test/apartmentsFetch'
import { expectBrowserHandlesModifiedClicks } from './test/linkClicks'

const APARTMENT_ID = SAMPLE_APARTMENTS[0].id
const ID_A = '11111111-1111-1111-1111-111111111111'
const ID_B = '22222222-2222-2222-2222-222222222222'
const ID_C = '33333333-3333-3333-3333-333333333333'

const FROM_HISTORY = `?view=history&apartment=${APARTMENT_ID}&status=needs_review`
const FROM_ITEMS = '?view=items&apartment=' + APARTMENT_ID

beforeEach(() => {
  window.history.replaceState({}, '', '/')
})
afterEach(() => {
  window.history.replaceState({}, '', '/')
})

let objectUrl: ReturnType<typeof mockObjectUrl>
beforeEach(() => {
  objectUrl = mockObjectUrl()
})
afterEach(() => {
  objectUrl.restore()
})

beforeEach(() => {
  clearApartmentsCache()
})

let fetchSpy: jest.Mock
beforeEach(() => {
  fetchSpy = jest.fn().mockImplementation(withApartments(() => Promise.reject(new Error('Unexpected fetch call'))))
  global.fetch = fetchSpy as unknown as typeof fetch
})
afterEach(() => {
  // @ts-expect-error cleaning up the test-only global fetch stub
  delete global.fetch
})

function receiptSummary(id: string, overrides: Record<string, unknown> = {}) {
  return {
    receipt_id: id,
    original_filename: 'receipt.jpg',
    store_name: `Store ${id}`,
    purchase_date: '2026-01-15',
    currency: 'USD',
    total: 8.64,
    created_at: '2026-01-15T10:00:00+00:00',
    apartment_id: APARTMENT_ID,
    apartment_name: SAMPLE_APARTMENTS[0].name,
    status: 'needs_review',
    ...overrides,
  }
}

function savedReceipt(id: string, overrides: Record<string, unknown> = {}) {
  return {
    receipt_id: id,
    store_name: `Store ${id}`,
    purchase_date: '2026-01-15',
    currency: 'USD',
    items: [],
    discounts: [],
    taxes: [],
    total: 8.64,
    warnings: [],
    edited: false,
    edited_at: null,
    apartment_id: APARTMENT_ID,
    apartment_name: SAMPLE_APARTMENTS[0].name,
    status: 'needs_review',
    original_filename: 'receipt.jpg',
    content_type: 'image/jpeg',
    created_at: '2026-01-15T10:00:00+00:00',
    updated_at: '2026-01-15T10:00:00+00:00',
    ...overrides,
  }
}

interface Routes {
  get?: (id: string) => unknown
  list?: () => unknown
  putStatus?: () => unknown
}

function routeFetch(routes: Routes) {
  fetchSpy.mockImplementation(
    withApartments((urlString, options) => {
      const method = options?.method ?? 'GET'

      if (urlString.includes('/extract')) {
        return Promise.reject(new Error(`Unexpected extract call to ${urlString}`))
      }
      if (urlString.endsWith('/apartment') && method === 'PUT') {
        return Promise.reject(new Error(`Unexpected PUT apartment call to ${urlString}`))
      }
      if (urlString.endsWith('/status') && method === 'PUT') {
        return routes.putStatus
          ? Promise.resolve(routes.putStatus())
          : Promise.reject(new Error(`Unexpected PUT status call to ${urlString}`))
      }
      if (method === 'GET' && urlString.includes('/receipts?')) {
        return routes.list
          ? Promise.resolve(routes.list())
          : Promise.reject(new Error(`Unexpected list call to ${urlString}`))
      }
      if (method === 'GET' && urlString.includes('/receipts/')) {
        const id = urlString.split('/receipts/')[1]
        return routes.get
          ? Promise.resolve(routes.get(id))
          : Promise.reject(new Error(`Unexpected GET call to ${urlString}`))
      }
      return Promise.reject(new Error(`Unexpected fetch call to ${urlString}`))
    }),
  )
}

function listOf(ids: string[], overridesById: Record<string, Record<string, unknown>> = {}) {
  const items = ids.map((id) => receiptSummary(id, overridesById[id]))
  return jsonResponse(200, { items, count: items.length })
}

async function open(id: string, from: string | null, routes: Routes) {
  const search = from ? `/?receipt=${id}&from=${encodeURIComponent(from)}` : `/?receipt=${id}`
  window.history.replaceState({}, '', search)
  routeFetch(routes)
  render(<ReceiptUpload />)
  await waitFor(() => {
    expect(screen.getByText(`Store ${id}`)).toBeInTheDocument()
  })
  await screen.findByRole('radiogroup', { name: 'Apartment' })
}

test('no review controls when opened without a `from` param', async () => {
  await open(ID_A, null, { get: (id) => jsonResponse(200, savedReceipt(id)) })

  expect(screen.queryByText(/^\d+ of \d+$/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Approve and next' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Next' })).not.toBeInTheDocument()
})

test('no review controls when `from` points to the items view', async () => {
  await open(ID_A, FROM_ITEMS, { get: (id) => jsonResponse(200, savedReceipt(id)) })

  expect(screen.queryByRole('button', { name: 'Approve and next' })).not.toBeInTheDocument()
})

test('no review controls when the snapshot request fails -- the receipt itself still works', async () => {
  await open(ID_A, FROM_HISTORY, {
    get: (id) => jsonResponse(200, savedReceipt(id)),
    list: () => jsonResponse(500, { detail: 'Server error' }),
  })

  expect(screen.queryByRole('button', { name: 'Approve and next' })).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  // The ordinary approve button still works regardless
  expect(screen.getByRole('button', { name: 'Mark as approved' })).toBeInTheDocument()
})

test('no review controls when the receipt is not in the fetched snapshot', async () => {
  await open(ID_A, FROM_HISTORY, {
    get: (id) => jsonResponse(200, savedReceipt(id)),
    list: () => listOf([ID_B, ID_C]),
  })

  await waitFor(() => {
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/receipts?'))).toBe(true)
  })
  expect(screen.queryByRole('button', { name: 'Approve and next' })).not.toBeInTheDocument()
})

test('shows "N of M", and Previous/Next are disabled at the ends', async () => {
  await open(ID_B, FROM_HISTORY, {
    get: (id) => jsonResponse(200, savedReceipt(id)),
    list: () => listOf([ID_A, ID_B, ID_C]),
  })

  await screen.findByText('2 of 3')
  // ID_B is in the middle: both Previous and Next are real links
  const previous = screen.getByRole('link', { name: 'Previous' })
  const next = screen.getByRole('link', { name: 'Next' })
  expect(previous).toHaveAttribute('href', `/?receipt=${ID_A}&from=${encodeURIComponent(FROM_HISTORY)}`)
  expect(next).toHaveAttribute('href', `/?receipt=${ID_C}&from=${encodeURIComponent(FROM_HISTORY)}`)
})

test('Previous is disabled (not a link) at the start of the snapshot', async () => {
  await open(ID_A, FROM_HISTORY, {
    get: (id) => jsonResponse(200, savedReceipt(id)),
    list: () => listOf([ID_A, ID_B, ID_C]),
  })
  await screen.findByText('1 of 3')
  expect(screen.queryByRole('link', { name: 'Previous' })).not.toBeInTheDocument()
  expect(screen.getByText('Previous')).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('link', { name: 'Next' })).toBeInTheDocument()
})

test('Next is disabled (not a link) at the end of the snapshot', async () => {
  await open(ID_C, FROM_HISTORY, {
    get: (id) => jsonResponse(200, savedReceipt(id)),
    list: () => listOf([ID_A, ID_B, ID_C]),
  })
  await screen.findByText('3 of 3')
  expect(screen.queryByRole('link', { name: 'Next' })).not.toBeInTheDocument()
  expect(screen.getByText('Next')).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('link', { name: 'Previous' })).toBeInTheDocument()
})

test('in review mode "Approve and next" is the one primary button, first, and "Mark as approved" is secondary', async () => {
  // Given a needs_review receipt opened from a filtered history list
  await open(ID_B, FROM_HISTORY, {
    get: (id) => jsonResponse(200, savedReceipt(id)),
    list: () => listOf([ID_A, ID_B, ID_C]),
  })
  await screen.findByText('2 of 3')

  // Then "Approve and next" is primary and comes first; "Mark as approved" is secondary
  const approveAndNext = screen.getByRole('button', { name: 'Approve and next' })
  const markAsApproved = screen.getByRole('button', { name: 'Mark as approved' })
  expect(approveAndNext.className).toMatch(/\bbg-brand\b/)
  expect(markAsApproved.className).not.toMatch(/\bbg-brand\b/)
  expect(approveAndNext.compareDocumentPosition(markAsApproved) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

test('outside review mode "Mark as approved" stays the primary button', async () => {
  // Given a needs_review receipt opened without a `from` param
  await open(ID_A, null, { get: (id) => jsonResponse(200, savedReceipt(id)) })

  // Then "Mark as approved" is primary
  expect(screen.getByRole('button', { name: 'Mark as approved' }).className).toMatch(/\bbg-brand\b/)
})

test('review-mode Next leaves ctrl/cmd-click to the browser; a plain click still moves in place', async () => {
  // Given the middle receipt of a filtered snapshot
  await open(ID_B, FROM_HISTORY, {
    get: (id) => jsonResponse(200, savedReceipt(id)),
    list: () => listOf([ID_A, ID_B, ID_C]),
  })
  await screen.findByText('2 of 3')
  const next = screen.getByRole('link', { name: 'Next' })

  // Then its href is the full target, modified clicks are not prevented, and a plain click moves to ID_C
  expect(next).toHaveAttribute('href', `/?receipt=${ID_C}&from=${encodeURIComponent(FROM_HISTORY)}`)
  expectBrowserHandlesModifiedClicks(next, `?receipt=${ID_C}&from=${encodeURIComponent(FROM_HISTORY)}`)
})

test('the snapshot uses the sort of the list the receipt came from, so "N of M" and Previous/Next follow that order', async () => {
  // Given a receipt opened from History sorted by total (high to low); the
  // backend returns that order: C, A, B
  const fromSorted = `?view=history&apartment=${APARTMENT_ID}&sort=amount_desc`
  await open(ID_A, fromSorted, {
    get: (id) => jsonResponse(200, savedReceipt(id)),
    list: () => listOf([ID_C, ID_A, ID_B]),
  })

  // Then the snapshot request asked for that sort
  await screen.findByText('2 of 3')
  const listCall = fetchSpy.mock.calls.map(([url]) => String(url)).find((url) => url.includes('/receipts?'))
  expect(new URL(listCall as string, 'http://x').searchParams.get('sort')).toBe('amount_desc')
  // And A is 2nd of 3, with C before it and B after it -- the sorted order, not upload order
  expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute(
    'href',
    `/?receipt=${ID_C}&from=${encodeURIComponent(fromSorted)}`,
  )
  expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute(
    'href',
    `/?receipt=${ID_B}&from=${encodeURIComponent(fromSorted)}`,
  )
})

test('the snapshot uses the file type of the list the receipt came from; an invalid type is not sent', async () => {
  // Given a receipt opened from History filtered to PDFs
  const fromPdf = `?view=history&apartment=${APARTMENT_ID}&type=pdf`
  await open(ID_A, fromPdf, {
    get: (id) => jsonResponse(200, savedReceipt(id)),
    list: () => listOf([ID_A, ID_B]),
  })

  // Then the snapshot request asked for PDFs only, and Next stays in that list
  await screen.findByText('1 of 2')
  const listCall = fetchSpy.mock.calls.map(([url]) => String(url)).find((url) => url.includes('/receipts?'))
  expect(new URL(listCall as string, 'http://x').searchParams.get('file_type')).toBe('pdf')
  expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute(
    'href',
    `/?receipt=${ID_B}&from=${encodeURIComponent(fromPdf)}`,
  )
})

test('an invalid type in the from= list is not sent with the snapshot request', async () => {
  // Given a hand-edited from= with an unknown type
  await open(ID_A, `?view=history&apartment=${APARTMENT_ID}&type=gif`, {
    get: (id) => jsonResponse(200, savedReceipt(id)),
    list: () => listOf([ID_A, ID_B]),
  })

  // Then no file_type is sent (all types)
  await screen.findByText('1 of 2')
  const listCall = fetchSpy.mock.calls.map(([url]) => String(url)).find((url) => url.includes('/receipts?'))
  expect(new URL(listCall as string, 'http://x').searchParams.get('file_type')).toBeNull()
})

test('opened from an unsorted (default) list, the snapshot sends the default date_desc', async () => {
  await open(ID_B, FROM_HISTORY, {
    get: (id) => jsonResponse(200, savedReceipt(id)),
    list: () => listOf([ID_A, ID_B, ID_C]),
  })
  await screen.findByText('2 of 3')
  const listCall = fetchSpy.mock.calls.map(([url]) => String(url)).find((url) => url.includes('/receipts?'))
  expect(new URL(listCall as string, 'http://x').searchParams.get('sort')).toBe('date_desc')
})

test('"Approve and next" sends exactly one PUT .../status and navigates to the next receipt still needing review, skipping an already-approved one', async () => {
  await open(ID_A, FROM_HISTORY, {
    get: (id) => jsonResponse(200, savedReceipt(id)),
    list: () => listOf([ID_A, ID_B, ID_C], { [ID_B]: { status: 'approved' } }),
    putStatus: () => jsonResponse(200, savedReceipt(ID_A, { status: 'approved' })),
  })
  const user = userEvent.setup()

  await user.click(screen.getByRole('button', { name: 'Approve and next' }))

  // Exactly one PUT is sent
  await waitFor(() => {
    expect(
      fetchSpy.mock.calls.filter(([url, options]) => String(url).endsWith('/status') && options?.method === 'PUT'),
    ).toHaveLength(1)
  })

  // ID_B is already approved, so the view navigates straight to ID_C
  await waitFor(() => {
    expect(screen.getByText(`Store ${ID_C}`)).toBeInTheDocument()
  })
  expect(window.location.search).toBe(`?receipt=${ID_C}&from=${encodeURIComponent(FROM_HISTORY)}`)
})

test('"Approve and next" with none left afterwards goes back to the list with a "reviewed" notice', async () => {
  await open(ID_C, FROM_HISTORY, {
    get: (id) => jsonResponse(200, savedReceipt(id)),
    list: () => listOf([ID_A, ID_B, ID_C], { [ID_A]: { status: 'approved' }, [ID_B]: { status: 'approved' } }),
    putStatus: () => jsonResponse(200, savedReceipt(ID_C, { status: 'approved' })),
  })
  const user = userEvent.setup()

  await user.click(screen.getByRole('button', { name: 'Approve and next' }))

  await waitFor(() => {
    expect(window.location.search).toBe(`${FROM_HISTORY}&notice=reviewed`)
  })
})

test('a 422 from "Approve and next" stays on the receipt and shows the plain-words message', async () => {
  await open(ID_A, FROM_HISTORY, {
    get: (id) => jsonResponse(200, savedReceipt(id)),
    list: () => listOf([ID_A, ID_B]),
    putStatus: () =>
      jsonResponse(422, {
        detail: { message: 'Missing fields.', missing: ['total'] },
      }),
  })
  const user = userEvent.setup()

  await user.click(screen.getByRole('button', { name: 'Approve and next' }))

  await waitFor(() => {
    expect(screen.getByText('To approve this receipt, also set: total.')).toBeInTheDocument()
  })
  // Stayed on the same receipt -- no navigation happened
  expect(screen.getByText(`Store ${ID_A}`)).toBeInTheDocument()
  expect(window.location.search).toBe(`?receipt=${ID_A}&from=${encodeURIComponent(FROM_HISTORY)}`)
})
