import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReceiptUpload from './ReceiptUpload'
import { mockObjectUrl } from './test/objectUrl'
import { SAMPLE_APARTMENTS, clearApartmentsCache, jsonResponse, withApartments } from './test/apartmentsFetch'

const VALID_UUID = '11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

// jsdom has neither URL.createObjectURL nor URL.revokeObjectURL; the
// right-after-extraction test here selects an image file.
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

function savedReceipt(overrides: Record<string, unknown> = {}) {
  return {
    receipt_id: VALID_UUID,
    store_name: 'Corner Store',
    purchase_date: '2026-01-15',
    currency: 'USD',
    items: [],
    discounts: [],
    taxes: [],
    total: 8.64,
    warnings: [],
    edited: false,
    edited_at: null,
    apartment_id: SAMPLE_APARTMENTS[0].id,
    apartment_name: SAMPLE_APARTMENTS[0].name,
    status: 'needs_review',
    original_filename: 'receipt.jpg',
    content_type: 'image/jpeg',
    created_at: '2026-01-15T10:00:00+00:00',
    updated_at: '2026-01-15T10:00:00+00:00',
    ...overrides,
  }
}

function routeFetch(
  routes: {
    get?: () => Promise<unknown>
    putStatus?: () => Promise<unknown>
  },
) {
  fetchSpy.mockImplementation(
    withApartments((urlString, options) => {
      const method = options?.method ?? 'GET'

      if (urlString.includes('/extract')) {
        return Promise.reject(new Error(`Unexpected extract call to ${urlString}`))
      }
      if (urlString.endsWith('/status') && method === 'PUT') {
        return routes.putStatus
          ? routes.putStatus()
          : Promise.reject(new Error(`Unexpected PUT status call to ${urlString}`))
      }
      if (urlString.endsWith('/apartment') && method === 'PUT') {
        return Promise.reject(new Error(`Unexpected PUT apartment call to ${urlString}`))
      }
      if (method === 'PUT') {
        return Promise.reject(new Error(`Unexpected plain PUT call to ${urlString}`))
      }
      if (method === 'GET' && urlString.includes('/receipts/')) {
        return routes.get
          ? routes.get()
          : Promise.reject(new Error(`Unexpected GET call to ${urlString}`))
      }
      return Promise.reject(new Error(`Unexpected fetch call to ${urlString}`))
    }),
  )
}

async function openSavedReceipt(receipt = savedReceipt()) {
  window.history.replaceState({}, '', `/?receipt=${VALID_UUID}`)
  routeFetch({ get: () => Promise.resolve(jsonResponse(200, receipt)) })
  render(<ReceiptUpload />)
  await waitFor(() => {
    expect(screen.getByText('Corner Store')).toBeInTheDocument()
  })
}

test('a saved receipt shows no Category control', async () => {
  // Given a saved receipt is open
  await openSavedReceipt()

  // Then there is no category select anywhere on the page
  expect(screen.queryByLabelText('Category')).not.toBeInTheDocument()
  expect(screen.queryByText('Choose a category')).not.toBeInTheDocument()
})

test('approving sends PUT .../status with only {"status":"approved"} and the badge changes', async () => {
  // Given a saved receipt that needs review
  await openSavedReceipt()
  routeFetch({
    get: () => Promise.resolve(jsonResponse(200, savedReceipt())),
    putStatus: () => Promise.resolve(jsonResponse(200, savedReceipt({ status: 'approved' }))),
  })
  const user = userEvent.setup()

  expect(screen.getByText('Needs review')).toBeInTheDocument()

  // When the user clicks "Mark as approved"
  await user.click(screen.getByRole('button', { name: 'Mark as approved' }))

  // Then exactly one PUT is sent with {"status": "approved"} -- and nothing else
  await waitFor(() => {
    expect(
      fetchSpy.mock.calls.filter(([url, options]) => String(url).endsWith('/status') && options?.method === 'PUT'),
    ).toHaveLength(1)
  })
  const [, options] = fetchSpy.mock.calls.find(
    ([callUrl, callOptions]) => String(callUrl).endsWith('/status') && callOptions?.method === 'PUT',
  )!
  expect(JSON.parse(options.body as string)).toEqual({ status: 'approved' })

  // And the badge changes to "Approved"
  await waitFor(() => {
    expect(screen.getByText('Approved')).toBeInTheDocument()
  })
  expect(screen.queryByText('Needs review')).not.toBeInTheDocument()
})

test('a 422 with missing ["apartment","date"] shows the plain-words message and the status stays unchanged', async () => {
  // Given a saved receipt missing an apartment and a valid date
  await openSavedReceipt()
  routeFetch({
    get: () => Promise.resolve(jsonResponse(200, savedReceipt())),
    putStatus: () =>
      Promise.resolve(
        jsonResponse(422, {
          detail: {
            message: 'This receipt is missing required information before it can be approved.',
            missing: ['apartment', 'date'],
          },
        }),
      ),
  })
  const user = userEvent.setup()

  // When the user clicks "Mark as approved"
  await user.click(screen.getByRole('button', { name: 'Mark as approved' }))

  // Then a plain-words error is shown naming exactly what's missing
  await waitFor(() => {
    expect(
      screen.getByText(
        'To approve this receipt, also set: apartment, a valid purchase date. You can fix the date with Edit.',
      ),
    ).toBeInTheDocument()
  })

  // And the status stays "Needs review"
  expect(screen.getByText('Needs review')).toBeInTheDocument()
  expect(screen.queryByText('Approved')).not.toBeInTheDocument()
})

test('a 422 missing an unrecognized "category" entry is ignored safely, never showing "undefined"', async () => {
  // Given a server (possibly not yet updated) still names "category" as missing
  await openSavedReceipt()
  routeFetch({
    get: () => Promise.resolve(jsonResponse(200, savedReceipt())),
    putStatus: () =>
      Promise.resolve(
        jsonResponse(422, {
          detail: {
            message: 'This receipt is missing required information before it can be approved.',
            missing: ['category', 'total'],
          },
        }),
      ),
  })
  const user = userEvent.setup()

  // When the user clicks "Mark as approved"
  await user.click(screen.getByRole('button', { name: 'Mark as approved' }))

  // Then the message only names the recognized field, never "undefined" or "category"
  await waitFor(() => {
    expect(screen.getByText('To approve this receipt, also set: total.')).toBeInTheDocument()
  })
  expect(document.body.textContent).not.toMatch(/undefined/i)
})

test('"Back to needs review" sends PUT .../status with {"status":"needs_review"}', async () => {
  // Given an approved receipt
  await openSavedReceipt(savedReceipt({ status: 'approved' }))
  routeFetch({
    get: () => Promise.resolve(jsonResponse(200, savedReceipt({ status: 'approved' }))),
    putStatus: () => Promise.resolve(jsonResponse(200, savedReceipt({ status: 'needs_review' }))),
  })
  const user = userEvent.setup()

  // When the user clicks "Back to needs review"
  await user.click(screen.getByRole('button', { name: 'Back to needs review' }))

  // Then the request is sent and the badge goes back to "Needs review"
  await waitFor(() => {
    const [, options] = fetchSpy.mock.calls.find(
      ([callUrl, callOptions]) => String(callUrl).endsWith('/status') && callOptions?.method === 'PUT',
    )!
    expect(JSON.parse(options.body as string)).toEqual({ status: 'needs_review' })
  })
  await waitFor(() => {
    expect(screen.getByText('Needs review')).toBeInTheDocument()
  })
})

test('the review status controls are hidden while the edit form is open', async () => {
  // Given a saved receipt is open
  await openSavedReceipt()
  const user = userEvent.setup()

  // When the user opens the edit form
  await user.click(screen.getByRole('button', { name: /^edit$/i }))

  // Then the status controls are no longer shown
  expect(screen.queryByText('Needs review')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Mark as approved' })).not.toBeInTheDocument()
})

test('right after extraction, the extract response\'s status is shown, with no Category control', async () => {
  // Given a file is selected, an apartment is chosen, and extraction returns
  // a receipt already carrying a status
  routeFetch({})
  fetchSpy.mockImplementation(
    withApartments((urlString) => {
      if (urlString.endsWith('/receipts/upload')) {
        return Promise.resolve(jsonResponse(201, { receipt_id: VALID_UUID, filename: 'receipt.jpg' }))
      }
      if (urlString.includes('/extract')) {
        return Promise.resolve(jsonResponse(200, savedReceipt()))
      }
      return Promise.reject(new Error(`Unexpected fetch call to ${urlString}`))
    }),
  )
  const user = userEvent.setup()
  render(<ReceiptUpload />)
  const validFile = new File(['dummy'], 'receipt.jpg', { type: 'image/jpeg' })
  await user.upload(screen.getByLabelText(/upload receipt/i), validFile)
  await user.click(await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name }))
  await user.click(screen.getByRole('button', { name: /read receipt/i }))

  // Then the result view shows the extracted status badge and no category control
  await waitFor(() => {
    expect(screen.getByText('Corner Store')).toBeInTheDocument()
  })
  expect(screen.getByText('Needs review')).toBeInTheDocument()
  expect(screen.queryByLabelText('Category')).not.toBeInTheDocument()
})

test('changing status never calls extract or the plain PUT /receipts/{id}', async () => {
  // Given a saved receipt is open and the server accepts a status change
  await openSavedReceipt()
  routeFetch({
    get: () => Promise.resolve(jsonResponse(200, savedReceipt())),
    putStatus: () => Promise.resolve(jsonResponse(200, savedReceipt({ status: 'approved' }))),
  })
  const user = userEvent.setup()

  // When the user clicks "Mark as approved"
  await user.click(screen.getByRole('button', { name: 'Mark as approved' }))
  await waitFor(() => {
    expect(screen.getByText('Approved')).toBeInTheDocument()
  })

  // Then no call was ever made to extract or to the plain (non-status/apartment) PUT
  // -- routeFetch itself rejects both, so a passing test proves neither fired
  expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/extract'))).toBe(false)
  expect(
    fetchSpy.mock.calls.some(
      ([url, options]) =>
        options?.method === 'PUT' && !String(url).endsWith('/status') && !String(url).endsWith('/apartment'),
    ),
  ).toBe(false)
})
