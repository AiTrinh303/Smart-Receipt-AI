import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReceiptUpload from './ReceiptUpload'

const VALID_UUID = '11111111-1111-1111-1111-111111111111'

function setUrl(search: string) {
  window.history.replaceState({}, '', `/${search}`)
}

beforeEach(() => {
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }
}

function routeFetch(
  fetchSpy: jest.Mock,
  routes: {
    get?: () => Promise<unknown>
    upload?: () => Promise<unknown>
    extract?: () => Promise<unknown>
  },
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

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

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

describe('reopening a saved receipt from its link', () => {
  let fetchSpy: jest.Mock

  beforeEach(() => {
    fetchSpy = jest.fn()
    global.fetch = fetchSpy as unknown as typeof fetch
  })

  afterEach(() => {
    // @ts-expect-error cleaning up the test-only global fetch stub
    delete global.fetch
  })

  test('valid ?receipt=<uuid> + GET returns 200 -> result view shown, GET called once, extract never called', async () => {
    // Given the URL has a valid receipt id and the server has that receipt saved
    setUrl(`?receipt=${VALID_UUID}`)
    routeFetch(fetchSpy, {
      get: () => Promise.resolve(jsonResponse(200, SAVED_RECEIPT)),
    })

    // When the app loads
    render(<ReceiptUpload />)

    // Then the result view is shown
    await waitFor(() => {
      expect(screen.getByText('Corner Store')).toBeInTheDocument()
    })

    // And only the GET endpoint was called, never the extract endpoint
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, options] = fetchSpy.mock.calls[0]
    expect(url).toBe(`http://localhost:8001/receipts/${VALID_UUID}`)
    expect(options?.method ?? 'GET').toBe('GET')
  })

  test('while loading -> "Loading receipt..." is shown', async () => {
    // Given the URL has a valid receipt id and the GET response has not resolved yet
    setUrl(`?receipt=${VALID_UUID}`)
    const deferred = createDeferred<unknown>()
    routeFetch(fetchSpy, { get: () => deferred.promise })

    // When the app loads
    render(<ReceiptUpload />)

    // Then "Loading receipt..." is shown
    expect(screen.getByText('Loading receipt...')).toBeInTheDocument()

    // Cleanup: resolve so the test doesn't leave a dangling promise
    deferred.resolve(jsonResponse(200, SAVED_RECEIPT))
    await waitFor(() => expect(screen.getByText('Corner Store')).toBeInTheDocument())
  })

  test('GET returns 404 -> "Receipt not found" is shown', async () => {
    // Given the URL has a valid-looking but unknown receipt id
    setUrl(`?receipt=${VALID_UUID}`)
    routeFetch(fetchSpy, {
      get: () => Promise.resolve(jsonResponse(404, { detail: 'Receipt not found.' })),
    })

    // When the app loads
    render(<ReceiptUpload />)

    // Then "Receipt not found" is shown
    await waitFor(() => {
      expect(screen.getByText('Receipt not found')).toBeInTheDocument()
    })
  })

  test('?receipt=not-a-uuid -> "Receipt not found" shown and fetch was not called', () => {
    // Given the URL has a receipt value that is not a valid UUID
    setUrl('?receipt=not-a-uuid')

    // When the app loads
    render(<ReceiptUpload />)

    // Then "Receipt not found" is shown and the server was never called
    expect(screen.getByText('Receipt not found')).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('GET network failure -> error shown, Retry calls GET again', async () => {
    // Given the URL has a valid receipt id and the first GET request fails outright
    setUrl(`?receipt=${VALID_UUID}`)
    let callCount = 0
    routeFetch(fetchSpy, {
      get: () => {
        callCount += 1
        if (callCount === 1) {
          return Promise.reject(new TypeError('Failed to fetch'))
        }
        return Promise.resolve(jsonResponse(200, SAVED_RECEIPT))
      },
    })
    const user = userEvent.setup()

    // When the app loads
    render(<ReceiptUpload />)

    // Then an error is shown
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Could not reach the server. Please try again.',
      )
    })

    // When the user clicks Retry
    await user.click(screen.getByRole('button', { name: /retry/i }))

    // Then the GET endpoint is called again and the result is shown
    await waitFor(() => {
      expect(screen.getByText('Corner Store')).toBeInTheDocument()
    })
    expect(callCount).toBe(2)
  })

  test('after upload then extract succeed -> the address bar contains ?receipt=<id>', async () => {
    // Given a valid file is selected and both upload and extract will succeed
    routeFetch(fetchSpy, {
      upload: () =>
        Promise.resolve(jsonResponse(201, { receipt_id: VALID_UUID, filename: 'receipt.jpg' })),
      extract: () => Promise.resolve(jsonResponse(200, SAVED_RECEIPT)),
    })
    const user = userEvent.setup()
    render(<ReceiptUpload />)
    const validFile = new File(['dummy'], 'receipt.jpg', { type: 'image/jpeg' })
    await user.upload(screen.getByLabelText(/upload receipt/i), validFile)

    // When the user clicks Submit
    await user.click(screen.getByRole('button', { name: /submit|uploading|extracting/i }))

    // Then the result view is shown and the address bar contains the receipt id
    await waitFor(() => {
      expect(screen.getByText('Corner Store')).toBeInTheDocument()
    })
    expect(window.location.search).toBe(`?receipt=${VALID_UUID}`)
  })

  test('"Upload another receipt" removes the receipt parameter and resets', async () => {
    // Given the result view is shown after reopening a saved receipt
    setUrl(`?receipt=${VALID_UUID}`)
    routeFetch(fetchSpy, {
      get: () => Promise.resolve(jsonResponse(200, SAVED_RECEIPT)),
    })
    const user = userEvent.setup()
    render(<ReceiptUpload />)
    await waitFor(() => {
      expect(screen.getByText('Corner Store')).toBeInTheDocument()
    })

    // When the user clicks "Upload another receipt"
    await user.click(screen.getByRole('button', { name: /upload another receipt/i }))

    // Then the state resets to the initial upload form and the receipt param is removed
    expect(screen.getByLabelText(/upload receipt/i)).toBeInTheDocument()
    expect(window.location.search).toBe('')
  })

  test('saved result with null fields and empty lists renders "Not detected", no null/undefined/NaN text', async () => {
    // Given a saved receipt where every nullable field is null and every list is empty
    setUrl(`?receipt=${VALID_UUID}`)
    routeFetch(fetchSpy, {
      get: () =>
        Promise.resolve(
          jsonResponse(200, {
            receipt_id: VALID_UUID,
            store_name: null,
            purchase_date: null,
            currency: null,
            items: [],
            discounts: [],
            taxes: [],
            total: null,
            original_filename: null,
            content_type: null,
            created_at: '2026-01-15T10:00:00+00:00',
            updated_at: '2026-01-15T10:00:00+00:00',
          }),
        ),
    })

    // When the app loads
    render(<ReceiptUpload />)

    // Then "Not detected" is shown and no raw null/undefined/NaN text ever leaks into the page
    await waitFor(() => {
      expect(screen.getAllByText('Not detected').length).toBeGreaterThan(0)
    })
    expect(document.body.textContent).not.toMatch(/\bnull\b/i)
    expect(document.body.textContent).not.toMatch(/\bundefined\b/i)
    expect(document.body.textContent).not.toMatch(/\bNaN\b/i)
  })
})
