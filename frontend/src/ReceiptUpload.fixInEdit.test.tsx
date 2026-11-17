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
    purchase_date: '26/06/2025',
    currency: 'USD',
    items: [],
    discounts: [],
    taxes: [],
    total: null,
    warnings: [
      { code: 'DATE_NOT_STANDARD', field: 'purchase_date', message: 'The date is not standard.', details: {} },
      { code: 'MISSING_TOTAL', field: 'total', message: 'The total is missing.', details: {} },
    ],
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

async function openSavedReceipt() {
  window.history.replaceState({}, '', `/?receipt=${VALID_UUID}`)
  fetchSpy.mockImplementation(
    withApartments((urlString) => {
      if (urlString.includes('/receipts/') && !urlString.includes('/extract')) {
        return Promise.resolve(jsonResponse(200, savedReceipt()))
      }
      return Promise.reject(new Error(`Unexpected fetch call to ${urlString}`))
    }),
  )
  render(<ReceiptUpload />)
  await waitFor(() => {
    expect(screen.getByText('Corner Store')).toBeInTheDocument()
  })
}

test('clicking "Fix in Edit" on the date warning opens the edit form with the date field focused', async () => {
  await openSavedReceipt()
  const user = userEvent.setup()

  const fixButtons = screen.getAllByRole('button', { name: 'Fix in Edit' })
  await user.click(fixButtons[0])

  expect(screen.getByRole('heading', { name: 'Edit receipt' })).toBeInTheDocument()
  expect(document.activeElement).toBe(screen.getByPlaceholderText('YYYY-MM-DD'))
})

test('clicking "Fix in Edit" on the total warning opens the edit form with the Total field focused', async () => {
  await openSavedReceipt()
  const user = userEvent.setup()

  const fixButtons = screen.getAllByRole('button', { name: 'Fix in Edit' })
  await user.click(fixButtons[1])

  expect(screen.getByRole('heading', { name: 'Edit receipt' })).toBeInTheDocument()
  expect(document.activeElement).toBe(screen.getByLabelText('Total'))
})

test('the plain "Edit" button still opens the edit form with no field forced into focus', async () => {
  await openSavedReceipt()
  const user = userEvent.setup()

  await user.click(screen.getByRole('button', { name: /^edit$/i }))

  expect(screen.getByRole('heading', { name: 'Edit receipt' })).toBeInTheDocument()
  expect(document.activeElement).not.toBe(screen.getByLabelText('Total'))
})
