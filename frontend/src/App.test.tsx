import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

beforeEach(() => {
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

test('renders the Smart Receipt AI heading', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: 'Smart Receipt AI' })).toBeInTheDocument()
})

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }
}

const VALID_UUID = '11111111-1111-1111-1111-111111111111'

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

function routeFetch(
  fetchSpy: jest.Mock,
  routes: { get?: () => Promise<unknown>; list?: () => Promise<unknown> },
) {
  fetchSpy.mockImplementation((url: unknown, options?: RequestInit) => {
    const urlString = String(url)
    const method = options?.method ?? 'GET'

    if (urlString.includes('/extract')) {
      return Promise.reject(new Error(`Unexpected extract call to ${urlString}`))
    }
    if (urlString.includes('/receipts?')) {
      return routes.list
        ? routes.list()
        : Promise.reject(new Error(`Unexpected list call to ${urlString}`))
    }
    if (method === 'GET' && urlString.includes('/receipts/')) {
      return routes.get
        ? routes.get()
        : Promise.reject(new Error(`Unexpected GET call to ${urlString}`))
    }
    return Promise.reject(new Error(`Unexpected fetch call to ${urlString}`))
  })
}

describe('navigation between upload, history and a saved receipt', () => {
  let fetchSpy: jest.Mock

  beforeEach(() => {
    fetchSpy = jest.fn()
    global.fetch = fetchSpy as unknown as typeof fetch
  })

  afterEach(() => {
    // @ts-expect-error cleaning up the test-only global fetch stub
    delete global.fetch
  })

  test('navigation links switch between the upload and history views', async () => {
    // Given the app is rendered on the upload view
    routeFetch(fetchSpy, {
      list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0 })),
    })
    const user = userEvent.setup()
    render(<App />)
    expect(screen.getByLabelText(/upload receipt/i)).toBeInTheDocument()

    // When the user clicks "History"
    await user.click(screen.getByRole('link', { name: /history/i }))

    // Then the history view is shown
    await waitFor(() => {
      expect(
        screen.getByText('No receipts yet. Upload your first receipt.'),
      ).toBeInTheDocument()
    })
    expect(window.location.search).toBe('?view=history')

    // When the user clicks "Upload"
    await user.click(screen.getByRole('link', { name: /^upload$/i }))

    // Then the upload view is shown again
    expect(screen.getByLabelText(/upload receipt/i)).toBeInTheDocument()
    expect(window.location.search).toBe('')
  })

  test('clicking a history row opens the detail view via ?receipt=<id>; extract is never called', async () => {
    // Given the history view shows one saved receipt
    window.history.replaceState({}, '', '/?view=history')
    routeFetch(fetchSpy, {
      list: () =>
        Promise.resolve(
          jsonResponse(200, {
            items: [
              {
                receipt_id: VALID_UUID,
                original_filename: 'receipt.jpg',
                store_name: 'Corner Store',
                purchase_date: '2026-01-15',
                currency: 'USD',
                total: 8.64,
                created_at: '2026-01-15T10:00:00+00:00',
              },
            ],
            count: 1,
          }),
        ),
      get: () => Promise.resolve(jsonResponse(200, SAVED_RECEIPT)),
    })
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('Corner Store')).toBeInTheDocument()
    })

    // When the user clicks the row
    await user.click(screen.getByRole('button', { name: /Corner Store/i }))

    // Then the address bar becomes ?receipt=<id> and the detail view loads from GET,
    // never from the extract endpoint
    await waitFor(() => {
      expect(window.location.search).toBe(`?receipt=${VALID_UUID}`)
    })
    await waitFor(() => {
      expect(screen.getByText('Total: USD 8.64')).toBeInTheDocument()
    })
    expect(
      fetchSpy.mock.calls.some(([url]) => String(url).includes('/extract')),
    ).toBe(false)
  })

  test('"Back to history" returns to the list', async () => {
    // Given a saved receipt is open via ?receipt=<id>
    window.history.replaceState({}, '', `/?receipt=${VALID_UUID}`)
    routeFetch(fetchSpy, {
      get: () => Promise.resolve(jsonResponse(200, SAVED_RECEIPT)),
      list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0 })),
    })
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('Corner Store')).toBeInTheDocument()
    })

    // When the user clicks "Back to history"
    await user.click(screen.getByRole('link', { name: /back to history/i }))

    // Then the history list is shown
    await waitFor(() => {
      expect(
        screen.getByText('No receipts yet. Upload your first receipt.'),
      ).toBeInTheDocument()
    })
    expect(window.location.search).toBe('?view=history')
  })
})
