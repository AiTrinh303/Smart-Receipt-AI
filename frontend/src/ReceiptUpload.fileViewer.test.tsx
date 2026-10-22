import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { mockObjectUrl } from './test/objectUrl'

beforeEach(() => {
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

// jsdom has neither URL.createObjectURL nor URL.revokeObjectURL; selecting a
// JPG/PNG now creates a preview object URL, so every test here needs this.
let objectUrl: ReturnType<typeof mockObjectUrl>
beforeEach(() => {
  objectUrl = mockObjectUrl()
})
afterEach(() => {
  objectUrl.restore()
})

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }
}

const VALID_UUID = '11111111-1111-1111-1111-111111111111'
const EXPECTED_FILE_URL = `http://localhost:8001/receipts/${VALID_UUID}/file`

const SAVED_RECEIPT = {
  receipt_id: VALID_UUID,
  store_name: 'Corner Store',
  purchase_date: '2026-01-15',
  currency: 'USD',
  items: [],
  discounts: [],
  taxes: [],
  total: 8.64,
  original_filename: 'receipt.jpg',
  content_type: 'image/jpeg',
  created_at: '2026-01-15T10:00:00+00:00',
  updated_at: '2026-01-15T10:00:00+00:00',
}

const SAVED_PDF_RECEIPT = {
  ...SAVED_RECEIPT,
  original_filename: 'receipt.pdf',
  content_type: 'application/pdf',
}

function routeFetch(
  fetchSpy: jest.Mock,
  routes: { get?: () => Promise<unknown>; upload?: () => Promise<unknown>; extract?: () => Promise<unknown> },
) {
  fetchSpy.mockImplementation((url: unknown, options?: RequestInit) => {
    const urlString = String(url)
    const method = options?.method ?? 'GET'

    if (urlString.endsWith('/receipts/upload')) {
      return routes.upload
        ? routes.upload()
        : Promise.reject(new Error(`Unexpected upload call to ${urlString}`))
    }
    if (urlString.includes('/extract')) {
      return routes.extract
        ? routes.extract()
        : Promise.reject(new Error(`Unexpected extract call to ${urlString}`))
    }
    if (method === 'GET' && urlString.includes('/receipts/')) {
      return routes.get
        ? routes.get()
        : Promise.reject(new Error(`Unexpected GET call to ${urlString}`))
    }
    return Promise.reject(new Error(`Unexpected fetch call to ${urlString}`))
  })
}

describe('showing the original file next to receipt data', () => {
  let fetchSpy: jest.Mock

  beforeEach(() => {
    fetchSpy = jest.fn()
    global.fetch = fetchSpy as unknown as typeof fetch
  })

  afterEach(() => {
    // @ts-expect-error cleaning up the test-only global fetch stub
    delete global.fetch
  })

  test('opening a saved receipt via ?receipt=<id> shows the viewer with that receipt\'s file URL', async () => {
    // Given a saved receipt is opened via its URL
    window.history.replaceState({}, '', `/?receipt=${VALID_UUID}`)
    routeFetch(fetchSpy, { get: () => Promise.resolve(jsonResponse(200, SAVED_RECEIPT)) })

    // When the app renders
    render(<App />)

    // Then the file viewer is shown pointing at that receipt's file endpoint
    await waitFor(() => {
      expect(screen.getByText('Corner Store')).toBeInTheDocument()
    })
    const img = screen.getByRole('img', { hidden: true }) as HTMLImageElement
    expect(img.src).toBe(EXPECTED_FILE_URL)

    // And the extract endpoint was never called
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/extract'))).toBe(false)
  })

  test('after upload and extraction, the viewer shows that receipt\'s file', async () => {
    // Given a file is selected and both upload and extraction will succeed
    routeFetch(fetchSpy, {
      upload: () => Promise.resolve(jsonResponse(201, { receipt_id: VALID_UUID, filename: 'receipt.jpg' })),
      extract: () =>
        Promise.resolve(
          jsonResponse(200, {
            receipt_id: VALID_UUID,
            store_name: 'Corner Store',
            items: [],
            discounts: [],
            taxes: [],
          }),
        ),
    })
    const user = userEvent.setup()
    render(<App />)
    const validFile = new File(['dummy'], 'receipt.jpg', { type: 'image/jpeg' })
    await user.upload(screen.getByLabelText(/upload receipt/i), validFile)
    await user.click(screen.getByRole('button', { name: /read receipt/i }))

    // Then the result view is shown with a viewer pointing at that receipt's file
    await waitFor(() => {
      expect(screen.getByText('Corner Store')).toBeInTheDocument()
    })
    const img = screen.getByRole('img', { hidden: true }) as HTMLImageElement
    expect(img.src).toBe(EXPECTED_FILE_URL)
  })

  test('edit mode shows the edit form and the viewer together', async () => {
    // Given a saved receipt is open
    window.history.replaceState({}, '', `/?receipt=${VALID_UUID}`)
    routeFetch(fetchSpy, { get: () => Promise.resolve(jsonResponse(200, SAVED_RECEIPT)) })
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('Corner Store')).toBeInTheDocument()
    })

    // When the user clicks Edit
    await user.click(screen.getByRole('button', { name: /^edit$/i }))

    // Then the edit form and the viewer are both present
    expect(screen.getByDisplayValue('Corner Store')).toBeInTheDocument()
    const img = screen.getByRole('img', { hidden: true }) as HTMLImageElement
    expect(img.src).toBe(EXPECTED_FILE_URL)
  })

  test('switching tabs updates aria-selected and preserves edit-form input', async () => {
    // Given the edit form is open on a saved receipt
    window.history.replaceState({}, '', `/?receipt=${VALID_UUID}`)
    routeFetch(fetchSpy, { get: () => Promise.resolve(jsonResponse(200, SAVED_RECEIPT)) })
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('Corner Store')).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /^edit$/i }))

    const dataTab = screen.getByRole('tab', { name: /receipt data/i })
    const originalTab = screen.getByRole('tab', { name: /^original$/i })
    expect(dataTab).toHaveAttribute('aria-selected', 'true')
    expect(originalTab).toHaveAttribute('aria-selected', 'false')

    // When the user types into the store name field
    const storeNameInput = screen.getByDisplayValue('Corner Store')
    fireEvent.change(storeNameInput, { target: { value: 'Updated Store' } })

    // And switches to the "Original" tab and back
    await user.click(originalTab)
    expect(originalTab).toHaveAttribute('aria-selected', 'true')
    expect(dataTab).toHaveAttribute('aria-selected', 'false')
    await user.click(dataTab)
    expect(dataTab).toHaveAttribute('aria-selected', 'true')

    // Then the typed value is still there
    expect(screen.getByDisplayValue('Updated Store')).toBeInTheDocument()
  })

  test('a receipt with a PDF content type renders the iframe', async () => {
    // Given a saved receipt whose original upload was a PDF
    window.history.replaceState({}, '', `/?receipt=${VALID_UUID}`)
    routeFetch(fetchSpy, { get: () => Promise.resolve(jsonResponse(200, SAVED_PDF_RECEIPT)) })

    // When the app renders
    render(<App />)

    // Then an iframe pointing at the file endpoint is shown
    await waitFor(() => {
      expect(screen.getByText('Corner Store')).toBeInTheDocument()
    })
    const iframe = screen.getByTitle(/original receipt pdf/i) as HTMLIFrameElement
    expect(iframe.src).toBe(EXPECTED_FILE_URL)
  })

  test('if the image fails to load, the "not available" message appears and data/Edit/Delete still work', async () => {
    // Given a saved receipt is open
    window.history.replaceState({}, '', `/?receipt=${VALID_UUID}`)
    routeFetch(fetchSpy, { get: () => Promise.resolve(jsonResponse(200, SAVED_RECEIPT)) })
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('Corner Store')).toBeInTheDocument()
    })

    // When the image fails to load
    const img = screen.getByRole('img', { hidden: true })
    fireEvent.error(img)

    // Then the not-available message is shown
    expect(screen.getByText('The original file is not available.')).toBeInTheDocument()

    // And the receipt data, Edit and Delete are still there and usable
    expect(screen.getByText('Corner Store')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument()
  })
})
