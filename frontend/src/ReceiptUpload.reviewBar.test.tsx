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

async function openSavedReceipt(receipt = savedReceipt()) {
  window.history.replaceState({}, '', `/?receipt=${VALID_UUID}`)
  fetchSpy.mockImplementation(
    withApartments((urlString) => {
      if (urlString.includes('/receipts/') && !urlString.includes('/extract')) {
        return Promise.resolve(jsonResponse(200, receipt))
      }
      return Promise.reject(new Error(`Unexpected fetch call to ${urlString}`))
    }),
  )
  render(<ReceiptUpload />)
  await waitFor(() => {
    expect(screen.getByText('Corner Store')).toBeInTheDocument()
  })
  await screen.findByRole('radiogroup', { name: 'Apartment' })
}

test('the review bar shows the status badge and the primary approve button, reachable by role and name', async () => {
  await openSavedReceipt()

  expect(screen.getByText('Needs review')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Mark as approved' })).toBeInTheDocument()
})

test('the review bar shows "Back to needs review" for an approved receipt', async () => {
  await openSavedReceipt(savedReceipt({ status: 'approved' }))

  expect(screen.getByText('Approved')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Back to needs review' })).toBeInTheDocument()
})

const TWO_WARNINGS = [
  { code: 'MISSING_STORE', field: 'store_name', message: 'Store name is missing.', details: {} },
  { code: 'MISSING_TOTAL', field: 'total', message: 'Total is missing.', details: {} },
]

test('a needs_review receipt with warnings shows "N warnings to check", which focuses the warning panel', async () => {
  // Given a needs_review receipt with two warnings
  await openSavedReceipt(savedReceipt({ warnings: TWO_WARNINGS }))
  const user = userEvent.setup()

  // When the link in the review bar is clicked
  const link = screen.getByRole('link', { name: '2 warnings to check' })
  await user.click(link)

  // Then focus moves to the warning panel's "Check these values" line
  expect(screen.getByText('Check these values')).toHaveFocus()
  // And approving is still possible
  expect(screen.getByRole('button', { name: 'Mark as approved' })).toBeEnabled()
})

test('one warning reads "1 warning to check"', async () => {
  await openSavedReceipt(savedReceipt({ warnings: [TWO_WARNINGS[0]] }))

  expect(screen.getByRole('link', { name: '1 warning to check' })).toBeInTheDocument()
})

test('no warnings link for a receipt without warnings', async () => {
  // Given a needs_review receipt without warnings
  await openSavedReceipt()

  // Then there is no warnings link
  expect(screen.queryByRole('link', { name: /warnings? to check/ })).not.toBeInTheDocument()
})

test('an approved receipt with warnings shows no warnings link', async () => {
  // Given an approved receipt that still has warnings
  await openSavedReceipt(savedReceipt({ status: 'approved', warnings: TWO_WARNINGS }))

  // Then the review bar shows no link (the panel itself is still shown)
  expect(screen.queryByRole('link', { name: /warnings? to check/ })).not.toBeInTheDocument()
  expect(screen.getByText('Check these values')).toBeInTheDocument()
})

test('the review bar is hidden while the edit form is open', async () => {
  await openSavedReceipt()
  const user = userEvent.setup()

  await user.click(screen.getByRole('button', { name: /^edit$/i }))

  expect(screen.queryByRole('button', { name: 'Mark as approved' })).not.toBeInTheDocument()
})

test('apartment options show the short name and place on two lines, with the full name as the accessible name', async () => {
  // Given the apartment list has a three-segment full name (the shape
  // apartmentShortName/apartmentPlace are built for)
  const threeSegmentApartment = { id: 'oberaudorf-bergblick', name: 'Fewo JoJo - Oberaudorf - Bergblick' }
  window.history.replaceState({}, '', `/?receipt=${VALID_UUID}`)
  fetchSpy.mockImplementation(
    withApartments(
      (urlString) => {
        if (urlString.includes('/receipts/') && !urlString.includes('/extract')) {
          return Promise.resolve(
            jsonResponse(
              200,
              savedReceipt({ apartment_id: threeSegmentApartment.id, apartment_name: threeSegmentApartment.name }),
            ),
          )
        }
        return Promise.reject(new Error(`Unexpected fetch call to ${urlString}`))
      },
      () => Promise.resolve(jsonResponse(200, { items: [threeSegmentApartment], count: 1 })),
    ),
  )
  render(<ReceiptUpload />)
  await waitFor(() => {
    expect(screen.getByText('Corner Store')).toBeInTheDocument()
  })

  await screen.findByText('Apartment')
  // Then the radio's accessible name is the full name, but the visible
  // text shows the short name and the place separately
  const radio = screen.getByRole('radio', { name: threeSegmentApartment.name })
  expect(radio).toBeInTheDocument()
  expect(screen.getByText('Bergblick')).toBeInTheDocument()
  expect(screen.getByText('Oberaudorf')).toBeInTheDocument()
})

test('"Upload another receipt" is a ghost button next to "Back to history", above the columns', async () => {
  window.history.replaceState({}, '', `/?receipt=${VALID_UUID}&from=${encodeURIComponent('?view=history&apartment=oberaudorf-bergblick')}`)
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

  const backLink = screen.getByRole('link', { name: /back to history/i })
  const uploadAnother = screen.getByRole('button', { name: /upload another receipt/i })
  expect(backLink).toBeInTheDocument()
  expect(uploadAnother).toBeInTheDocument()
  // Both sit in the same row, above the two-column layout
  expect(backLink.parentElement).toBe(uploadAnother.parentElement)
})
