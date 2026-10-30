import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReceiptUpload from './ReceiptUpload'
import { mockObjectUrl } from './test/objectUrl'
import { SAMPLE_APARTMENTS, clearApartmentsCache, jsonResponse, withApartments } from './test/apartmentsFetch'
import { clearCategoriesCache, withCategories } from './test/categoriesFetch'

const VALID_UUID = '11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

// jsdom has neither URL.createObjectURL nor URL.revokeObjectURL; the
// right-after-extraction tests here select an image file.
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
    .mockImplementation(withApartments(withCategories(() => Promise.reject(new Error('Unexpected fetch call')))))
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
    category_id: null,
    category_name: null,
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
    putApartment?: () => Promise<unknown>
  },
) {
  fetchSpy.mockImplementation(
    withApartments(
      withCategories((urlString, options) => {
        const method = options?.method ?? 'GET'

        if (urlString.includes('/extract')) {
          return Promise.reject(new Error(`Unexpected extract call to ${urlString}`))
        }
        if (urlString.endsWith('/apartment') && method === 'PUT') {
          return routes.putApartment
            ? routes.putApartment()
            : Promise.reject(new Error(`Unexpected PUT apartment call to ${urlString}`))
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
  // The apartment control fetches its options separately (and after) the
  // receipt GET resolves; wait for it too before interacting with it.
  await screen.findByRole('radiogroup', { name: 'Apartment' })
}

function getApartmentGroup() {
  return screen.getByRole('radiogroup', { name: 'Apartment' })
}

test('a saved receipt shows its current apartment selected', async () => {
  // Given a saved receipt whose apartment is the first mocked one
  await openSavedReceipt()

  // Then that apartment's radio is checked, the other is not
  const group = getApartmentGroup()
  expect(screen.getByRole('radio', { name: SAMPLE_APARTMENTS[0].name })).toBeChecked()
  expect(screen.getByRole('radio', { name: SAMPLE_APARTMENTS[1].name })).not.toBeChecked()
  expect(group).toBeInTheDocument()
})

test('choosing another apartment sends exactly one PUT with the new apartment_id, then shows it and "Saved"', async () => {
  // Given a saved receipt is open and the server will accept a change
  await openSavedReceipt()
  routeFetch({
    get: () => Promise.resolve(jsonResponse(200, savedReceipt())),
    putApartment: () =>
      Promise.resolve(
        jsonResponse(
          200,
          savedReceipt({ apartment_id: SAMPLE_APARTMENTS[1].id, apartment_name: SAMPLE_APARTMENTS[1].name }),
        ),
      ),
  })
  const user = userEvent.setup()

  // When the user chooses the other apartment
  await user.click(screen.getByRole('radio', { name: SAMPLE_APARTMENTS[1].name }))

  // Then exactly one PUT is sent to the apartment endpoint with the new id
  await waitFor(() => {
    expect(
      fetchSpy.mock.calls.filter(
        ([url, options]) => String(url).endsWith('/apartment') && options?.method === 'PUT',
      ),
    ).toHaveLength(1)
  })
  const [url, options] = fetchSpy.mock.calls.find(
    ([callUrl, callOptions]) => String(callUrl).endsWith('/apartment') && callOptions?.method === 'PUT',
  )!
  expect(url).toBe(`http://localhost:8001/receipts/${VALID_UUID}/apartment`)
  expect(JSON.parse(options.body as string)).toEqual({ apartment_id: SAMPLE_APARTMENTS[1].id })

  // And the new value is shown, selected, with a "Saved" status
  await waitFor(() => {
    expect(screen.getByRole('radio', { name: SAMPLE_APARTMENTS[1].name })).toBeChecked()
  })
  const saved = screen.getByText('Saved')
  expect(saved).toHaveAttribute('role', 'status')
})

test('while saving, "Saving..." is shown and the group is disabled', async () => {
  // Given a saved receipt is open and the PUT has not resolved yet
  await openSavedReceipt()
  let resolvePut!: (value: unknown) => void
  const deferred = new Promise((resolve) => {
    resolvePut = resolve
  })
  routeFetch({
    get: () => Promise.resolve(jsonResponse(200, savedReceipt())),
    putApartment: () => deferred,
  })
  const user = userEvent.setup()

  // When the user chooses another apartment
  await user.click(screen.getByRole('radio', { name: SAMPLE_APARTMENTS[1].name }))

  // Then "Saving..." is shown and the radio options are disabled
  expect(screen.getByText('Saving...')).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: SAMPLE_APARTMENTS[0].name })).toBeDisabled()
  expect(screen.getByRole('radio', { name: SAMPLE_APARTMENTS[1].name })).toBeDisabled()

  // Cleanup
  resolvePut(
    jsonResponse(
      200,
      savedReceipt({ apartment_id: SAMPLE_APARTMENTS[1].id, apartment_name: SAMPLE_APARTMENTS[1].name }),
    ),
  )
  await waitFor(() => expect(screen.queryByText('Saving...')).not.toBeInTheDocument())
})

test('a failed save reverts the selection, shows an error, and allows retrying', async () => {
  // Given a saved receipt is open and the first save attempt fails
  await openSavedReceipt()
  let callCount = 0
  routeFetch({
    get: () => Promise.resolve(jsonResponse(200, savedReceipt())),
    putApartment: () => {
      callCount += 1
      if (callCount === 1) {
        return Promise.resolve(jsonResponse(500, { detail: 'Could not update the apartment. Please try again.' }))
      }
      return Promise.resolve(
        jsonResponse(
          200,
          savedReceipt({ apartment_id: SAMPLE_APARTMENTS[1].id, apartment_name: SAMPLE_APARTMENTS[1].name }),
        ),
      )
    },
  })
  const user = userEvent.setup()

  // When the user chooses the other apartment
  await user.click(screen.getByRole('radio', { name: SAMPLE_APARTMENTS[1].name }))

  // Then an error is shown and the original apartment is selected again
  await waitFor(() => {
    expect(screen.getByText('Could not update the apartment. Please try again.')).toBeInTheDocument()
  })
  expect(screen.getByRole('radio', { name: SAMPLE_APARTMENTS[0].name })).toBeChecked()
  expect(screen.getByRole('radio', { name: SAMPLE_APARTMENTS[1].name })).not.toBeChecked()

  // When the user tries again
  await user.click(screen.getByRole('radio', { name: SAMPLE_APARTMENTS[1].name }))

  // Then the second attempt succeeds
  await waitFor(() => {
    expect(screen.getByRole('radio', { name: SAMPLE_APARTMENTS[1].name })).toBeChecked()
  })
  expect(callCount).toBe(2)
})

test('the apartment control is hidden while the edit form is open', async () => {
  // Given a saved receipt is open
  await openSavedReceipt()
  const user = userEvent.setup()

  // When the user opens the edit form
  await user.click(screen.getByRole('button', { name: /^edit$/i }))

  // Then the apartment control is no longer shown
  expect(screen.queryByRole('radiogroup', { name: 'Apartment' })).not.toBeInTheDocument()
})

test('right after extraction, the extract response\'s apartment is shown', async () => {
  // Given a file is selected, an apartment is chosen for the upload, and extraction returns
  // a receipt already carrying that same apartment
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

  // Then the result view shows the extracted apartment already selected
  await waitFor(() => {
    expect(screen.getByText('Corner Store')).toBeInTheDocument()
  })
  expect(screen.getByRole('radio', { name: SAMPLE_APARTMENTS[0].name })).toBeChecked()
})

test('changing the apartment never calls extract or the plain PUT /receipts/{id}', async () => {
  // Given a saved receipt is open and the server accepts the apartment change
  await openSavedReceipt()
  routeFetch({
    get: () => Promise.resolve(jsonResponse(200, savedReceipt())),
    putApartment: () =>
      Promise.resolve(
        jsonResponse(
          200,
          savedReceipt({ apartment_id: SAMPLE_APARTMENTS[1].id, apartment_name: SAMPLE_APARTMENTS[1].name }),
        ),
      ),
  })
  const user = userEvent.setup()

  // When the user chooses another apartment
  await user.click(screen.getByRole('radio', { name: SAMPLE_APARTMENTS[1].name }))
  await waitFor(() => {
    expect(screen.getByRole('radio', { name: SAMPLE_APARTMENTS[1].name })).toBeChecked()
  })

  // Then no call was ever made to extract or to the plain (non-apartment) PUT
  // -- routeFetch itself rejects both, so a passing test proves neither fired
  expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/extract'))).toBe(false)
  expect(
    fetchSpy.mock.calls.some(
      ([url, options]) => options?.method === 'PUT' && !String(url).endsWith('/apartment'),
    ),
  ).toBe(false)
})

test('a null apartment_id renders the group with nothing selected and no extra message', async () => {
  // Given a saved receipt that has no apartment assigned
  await openSavedReceipt(savedReceipt({ apartment_id: null, apartment_name: null }))

  // Then neither option is checked, and no error or "Saved" status is shown
  expect(screen.getByRole('radio', { name: SAMPLE_APARTMENTS[0].name })).not.toBeChecked()
  expect(screen.getByRole('radio', { name: SAMPLE_APARTMENTS[1].name })).not.toBeChecked()
  expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
