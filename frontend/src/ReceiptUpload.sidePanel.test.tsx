import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ReceiptUpload from './ReceiptUpload'
import { mockObjectUrl } from './test/objectUrl'
import { SAMPLE_APARTMENTS, clearApartmentsCache, jsonResponse, withApartments } from './test/apartmentsFetch'

const FACETS = {
  apartments: [{ id: SAMPLE_APARTMENTS[0].id, name: SAMPLE_APARTMENTS[0].name, count: 3 }],
  total: 3,
  years: [2026],
  has_undated: false,
}

function latestItem(id: string) {
  return {
    receipt_id: id,
    original_filename: 'a.jpg',
    store_name: 'Edeka',
    purchase_date: '2026-11-20',
    currency: 'EUR',
    total: 5,
    created_at: '2026-11-25T10:00:00Z',
    apartment_id: SAMPLE_APARTMENTS[0].id,
    apartment_name: SAMPLE_APARTMENTS[0].name,
    status: 'needs_review',
  }
}

function extractionBody(receiptId: string) {
  return {
    receipt_id: receiptId,
    store_name: 'Store',
    purchase_date: '2026-01-15',
    currency: 'EUR',
    items: [],
    discounts: [],
    taxes: [],
    total: 10,
    warnings: [],
    edited: false,
    edited_at: null,
    apartment_id: SAMPLE_APARTMENTS[0].id,
    apartment_name: SAMPLE_APARTMENTS[0].name,
    status: 'needs_review',
  }
}

let fetchSpy: jest.Mock
let facetsTotal: number
let uploadCount: number
let objectUrl: ReturnType<typeof mockObjectUrl>

beforeEach(() => {
  window.history.replaceState({}, '', '/')
  clearApartmentsCache()
  objectUrl = mockObjectUrl()
  facetsTotal = 3
  uploadCount = 0
  fetchSpy = jest.fn().mockImplementation(
    withApartments((urlString: string) => {
      if (urlString.includes('/receipts/facets')) {
        return Promise.resolve(jsonResponse(200, { ...FACETS, total: facetsTotal }))
      }
      if (urlString.includes('/receipts?')) {
        return Promise.resolve(jsonResponse(200, { items: [latestItem('11111111-1111-4111-8111-111111111111')], count: 1, total: 1 }))
      }
      if (urlString.endsWith('/receipts/upload')) {
        uploadCount += 1
        const id = `0000000${uploadCount}-0000-4000-8000-000000000000`
        return Promise.resolve(jsonResponse(201, { receipt_id: id, filename: 'x.jpg' }))
      }
      if (urlString.includes('/extract')) {
        const receiptId = urlString.split('/receipts/')[1].split('/extract')[0]
        return Promise.resolve(jsonResponse(200, extractionBody(receiptId)))
      }
      return Promise.reject(new Error(`Unexpected fetch call to ${urlString}`))
    }),
  )
  global.fetch = fetchSpy as unknown as typeof fetch
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
  clearApartmentsCache()
  objectUrl.restore()
  // @ts-expect-error cleaning up the test-only global fetch stub
  delete global.fetch
  // @ts-expect-error cleaning up the test-only global matchMedia stub
  delete window.matchMedia
})

function mockMatchMedia(matches: boolean) {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }))
}

function facetsCalls(): number {
  return fetchSpy.mock.calls.filter(([url]) => String(url).includes('/receipts/facets')).length
}

function latestCalls(): number {
  return fetchSpy.mock.calls.filter(([url]) => String(url).includes('/receipts?')).length
}

function selectFiles(files: File[]) {
  fireEvent.change(screen.getByLabelText(/upload receipt/i), { target: { files } })
}

test('below lg (matchMedia unavailable), no side panel renders and nothing is fetched for it', async () => {
  // Given no matchMedia (jsdom's default -- the below-lg variant)
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })

  // Then neither panel variant exists, the collapsible tips do, and no
  // facets/latest request was ever made
  expect(screen.queryByText('Your receipts')).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { level: 2, name: 'How it works' })).not.toBeInTheDocument()
  expect(screen.getByText('Tips for better reading').closest('summary')).toBeInTheDocument()
  expect(facetsCalls()).toBe(0)
  expect(latestCalls()).toBe(0)
})

test('below lg with matchMedia reporting false, the side panel is absent too', async () => {
  // Given a narrow screen
  mockMatchMedia(false)
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })

  // Then no panel and no fetch for it
  expect(screen.queryByText('Your receipts')).not.toBeInTheDocument()
  expect(facetsCalls()).toBe(0)
})

test('from lg up, the overview replaces the help, and the tips exist exactly once (inside the panel)', async () => {
  // Given a wide screen with saved receipts
  mockMatchMedia(true)
  render(<ReceiptUpload />)

  // When the panel loads
  expect(await screen.findByRole('heading', { level: 2, name: 'Your receipts' })).toBeInTheDocument()

  // Then the under-dropzone collapsible tips are not rendered, and the
  // tips text appears once -- in the panel's own <details>
  expect(screen.queryByText('Tips for better reading', { selector: 'summary' })).not.toBeInTheDocument()
  expect(screen.getAllByText('Lay the receipt flat.')).toHaveLength(1)
  expect(screen.getAllByText('How it works and tips')).toHaveLength(1)
  expect(facetsCalls()).toBe(1)
  expect(latestCalls()).toBe(1)
})

test('after a single upload is read, the overview is refreshed exactly once', async () => {
  // Given a wide screen and a loaded overview
  mockMatchMedia(true)
  render(<ReceiptUpload />)
  await screen.findByText('3 receipts saved')
  facetsTotal = 4

  // When one receipt is uploaded and read
  fireEvent.click(screen.getByRole('radio', { name: SAMPLE_APARTMENTS[0].name }))
  selectFiles([new File(['dummy'], 'one.jpg', { type: 'image/jpeg' })])
  await screen.findByText('Selected file: one.jpg')
  fireEvent.click(screen.getByRole('button', { name: /^read receipt$/i }))
  await screen.findByRole('button', { name: 'Upload another receipt' })

  // And the owner goes back to the form
  fireEvent.click(screen.getByRole('button', { name: 'Upload another receipt' }))

  // Then the panel shows the new total, fetched once more (not twice)
  expect(await screen.findByText('4 receipts saved')).toBeInTheDocument()
  expect(facetsCalls()).toBe(2)
  expect(latestCalls()).toBe(2)
})

test('when a batch finishes, the overview is refreshed exactly once (not per item)', async () => {
  // Given a wide screen, a loaded overview and 2 queued files
  mockMatchMedia(true)
  render(<ReceiptUpload />)
  await screen.findByText('3 receipts saved')
  fireEvent.click(screen.getByRole('radio', { name: SAMPLE_APARTMENTS[0].name }))
  selectFiles([new File(['a'], 'a.jpg', { type: 'image/jpeg' }), new File(['b'], 'b.jpg', { type: 'image/jpeg' })])
  const start = await screen.findByRole('button', { name: /read 2 receipts/i })
  await waitFor(() => expect(start).toBeEnabled())
  facetsTotal = 5

  // When the batch runs to the end
  fireEvent.click(start)
  await screen.findByText(/Done: 2 read, 0 failed\./)

  // Then the panel refetched once and shows the new total
  expect(await screen.findByText('5 receipts saved')).toBeInTheDocument()
  expect(facetsCalls()).toBe(2)
  expect(latestCalls()).toBe(2)
})
