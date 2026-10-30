import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReceiptUpload from './ReceiptUpload'
import { mockObjectUrl } from './test/objectUrl'
import { SAMPLE_APARTMENTS, clearApartmentsCache, jsonResponse, withApartments } from './test/apartmentsFetch'
import { SAMPLE_CATEGORIES, clearCategoriesCache, withCategories } from './test/categoriesFetch'

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
  clearCategoriesCache()
})

let fetchSpy: jest.Mock
beforeEach(() => {
  fetchSpy = jest
    .fn()
    .mockImplementation(
      withApartments(withCategories(() => Promise.reject(new Error('Unexpected fetch call')))),
    )
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
    category_id: SAMPLE_CATEGORIES[0].id,
    category_name: SAMPLE_CATEGORIES[0].name,
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
    putCategory?: () => Promise<unknown>
    putStatus?: () => Promise<unknown>
  },
) {
  fetchSpy.mockImplementation(
    withApartments(
      withCategories((urlString, options) => {
        const method = options?.method ?? 'GET'

        if (urlString.includes('/extract')) {
          return Promise.reject(new Error(`Unexpected extract call to ${urlString}`))
        }
        if (urlString.endsWith('/category') && method === 'PUT') {
          return routes.putCategory
            ? routes.putCategory()
            : Promise.reject(new Error(`Unexpected PUT category call to ${urlString}`))
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
    ),
  )
}

async function openSavedReceipt(receipt = savedReceipt()) {
  window.history.replaceState({}, '', `/?receipt=${VALID_UUID}`)
  routeFetch({ get: () => Promise.resolve(jsonResponse(200, receipt)) })
  render(<ReceiptUpload />)
  await waitFor(() => {
    expect(screen.getByText('Corner Store')).toBeInTheDocument()
  })
  // The category select fetches its options separately (and after) the
  // receipt GET resolves; wait for it too before interacting with it.
  await screen.findByLabelText('Category')
}

function getCategorySelect() {
  return screen.getByLabelText('Category') as HTMLSelectElement
}

test('the select shows the categories and the current one selected', async () => {
  // Given a saved receipt whose category is the first mocked one
  await openSavedReceipt()

  // Then the select has every category plus the placeholder, and the
  // current one is selected
  const select = getCategorySelect()
  expect(screen.getByRole('option', { name: 'Choose a category' })).toBeInTheDocument()
  expect(screen.getByRole('option', { name: SAMPLE_CATEGORIES[0].name })).toBeInTheDocument()
  expect(screen.getByRole('option', { name: SAMPLE_CATEGORIES[1].name })).toBeInTheDocument()
  expect(select.value).toBe(SAMPLE_CATEGORIES[0].id)
})

test('choosing another category sends exactly one PUT with the new category_id, then shows it and "Saved"', async () => {
  // Given a saved receipt is open and the server will accept a change
  await openSavedReceipt()
  routeFetch({
    get: () => Promise.resolve(jsonResponse(200, savedReceipt())),
    putCategory: () =>
      Promise.resolve(
        jsonResponse(
          200,
          savedReceipt({ category_id: SAMPLE_CATEGORIES[1].id, category_name: SAMPLE_CATEGORIES[1].name }),
        ),
      ),
  })
  const user = userEvent.setup()

  // When the user chooses the other category
  await user.selectOptions(getCategorySelect(), SAMPLE_CATEGORIES[1].id)

  // Then exactly one PUT is sent to the category endpoint with the new id
  await waitFor(() => {
    expect(
      fetchSpy.mock.calls.filter(
        ([url, options]) => String(url).endsWith('/category') && options?.method === 'PUT',
      ),
    ).toHaveLength(1)
  })
  const [url, options] = fetchSpy.mock.calls.find(
    ([callUrl, callOptions]) => String(callUrl).endsWith('/category') && callOptions?.method === 'PUT',
  )!
  expect(url).toBe(`http://localhost:8001/receipts/${VALID_UUID}/category`)
  expect(JSON.parse(options.body as string)).toEqual({ category_id: SAMPLE_CATEGORIES[1].id })

  // And the new value is shown, selected, with a "Saved" status
  await waitFor(() => {
    expect(getCategorySelect().value).toBe(SAMPLE_CATEGORIES[1].id)
  })
  const saved = screen.getByText('Saved')
  expect(saved).toHaveAttribute('role', 'status')
})

test('a failed category save reverts the selection and shows an error', async () => {
  // Given a saved receipt is open and the save attempt fails
  await openSavedReceipt()
  routeFetch({
    get: () => Promise.resolve(jsonResponse(200, savedReceipt())),
    putCategory: () =>
      Promise.resolve(jsonResponse(500, { detail: 'Could not update the category. Please try again.' })),
  })
  const user = userEvent.setup()

  // When the user chooses another category
  await user.selectOptions(getCategorySelect(), SAMPLE_CATEGORIES[1].id)

  // Then an error is shown and the original category is selected again
  await waitFor(() => {
    expect(screen.getByText('Could not update the category. Please try again.')).toBeInTheDocument()
  })
  expect(getCategorySelect().value).toBe(SAMPLE_CATEGORIES[0].id)
})

test('approving sends PUT .../status with {"status":"approved"} and the badge changes', async () => {
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

  // Then exactly one PUT is sent with {"status": "approved"}
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

test('a 422 with a missing list shows the plain-words message and the status stays unchanged', async () => {
  // Given a saved receipt missing an apartment and a category
  await openSavedReceipt()
  routeFetch({
    get: () => Promise.resolve(jsonResponse(200, savedReceipt())),
    putStatus: () =>
      Promise.resolve(
        jsonResponse(422, {
          detail: {
            message: 'This receipt is missing required information before it can be approved.',
            missing: ['apartment', 'category'],
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
      screen.getByText('To approve this receipt, also set: apartment, category.'),
    ).toBeInTheDocument()
  })

  // And the status stays "Needs review"
  expect(screen.getByText('Needs review')).toBeInTheDocument()
  expect(screen.queryByText('Approved')).not.toBeInTheDocument()
})

test('a 422 missing the date tells the user they can fix it with Edit', async () => {
  // Given a saved receipt with an invalid purchase date
  await openSavedReceipt()
  routeFetch({
    get: () => Promise.resolve(jsonResponse(200, savedReceipt())),
    putStatus: () =>
      Promise.resolve(
        jsonResponse(422, {
          detail: {
            message: 'This receipt is missing required information before it can be approved.',
            missing: ['date'],
          },
        }),
      ),
  })
  const user = userEvent.setup()

  // When the user clicks "Mark as approved"
  await user.click(screen.getByRole('button', { name: 'Mark as approved' }))

  // Then the message explains the date issue and points to Edit
  await waitFor(() => {
    expect(
      screen.getByText(
        'To approve this receipt, also set: a valid purchase date. You can fix the date with Edit.',
      ),
    ).toBeInTheDocument()
  })
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

test('the classification controls are hidden while the edit form is open', async () => {
  // Given a saved receipt is open
  await openSavedReceipt()
  const user = userEvent.setup()

  // When the user opens the edit form
  await user.click(screen.getByRole('button', { name: /^edit$/i }))

  // Then the category select and status controls are no longer shown
  expect(screen.queryByLabelText('Category')).not.toBeInTheDocument()
  expect(screen.queryByText('Needs review')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Mark as approved' })).not.toBeInTheDocument()
})

test('right after extraction, the extract response\'s category and status are shown', async () => {
  // Given a file is selected, an apartment is chosen, and extraction returns
  // a receipt already carrying a category and status
  routeFetch({})
  fetchSpy.mockImplementation(
    withApartments(
      withCategories((urlString) => {
        if (urlString.endsWith('/receipts/upload')) {
          return Promise.resolve(jsonResponse(201, { receipt_id: VALID_UUID, filename: 'receipt.jpg' }))
        }
        if (urlString.includes('/extract')) {
          return Promise.resolve(jsonResponse(200, savedReceipt()))
        }
        return Promise.reject(new Error(`Unexpected fetch call to ${urlString}`))
      }),
    ),
  )
  const user = userEvent.setup()
  render(<ReceiptUpload />)
  const validFile = new File(['dummy'], 'receipt.jpg', { type: 'image/jpeg' })
  await user.upload(screen.getByLabelText(/upload receipt/i), validFile)
  await user.click(await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name }))
  await user.click(screen.getByRole('button', { name: /read receipt/i }))

  // Then the result view shows the extracted category selected and its status badge
  await waitFor(() => {
    expect(screen.getByText('Corner Store')).toBeInTheDocument()
  })
  expect(await screen.findByLabelText('Category')).toHaveValue(SAMPLE_CATEGORIES[0].id)
  expect(screen.getByText('Needs review')).toBeInTheDocument()
})

test('changing category or status never calls extract or the plain PUT /receipts/{id}', async () => {
  // Given a saved receipt is open and the server accepts a category change
  await openSavedReceipt()
  routeFetch({
    get: () => Promise.resolve(jsonResponse(200, savedReceipt())),
    putCategory: () =>
      Promise.resolve(
        jsonResponse(
          200,
          savedReceipt({ category_id: SAMPLE_CATEGORIES[1].id, category_name: SAMPLE_CATEGORIES[1].name }),
        ),
      ),
  })
  const user = userEvent.setup()

  // When the user chooses another category
  await user.selectOptions(getCategorySelect(), SAMPLE_CATEGORIES[1].id)
  await waitFor(() => {
    expect(getCategorySelect().value).toBe(SAMPLE_CATEGORIES[1].id)
  })

  // Then no call was ever made to extract or to the plain (non-category/status) PUT
  // -- routeFetch itself rejects both, so a passing test proves neither fired
  expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/extract'))).toBe(false)
  expect(
    fetchSpy.mock.calls.some(
      ([url, options]) =>
        options?.method === 'PUT' &&
        !String(url).endsWith('/category') &&
        !String(url).endsWith('/status') &&
        !String(url).endsWith('/apartment'),
    ),
  ).toBe(false)
})
