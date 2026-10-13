import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReceiptHistory from './ReceiptHistory'

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

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const THREE_ITEMS = [
  {
    receipt_id: '33333333-3333-3333-3333-333333333333',
    original_filename: 'c.jpg',
    store_name: 'Store C',
    purchase_date: '2026-01-17',
    currency: 'USD',
    total: 30,
    created_at: '2026-01-17T00:00:00+00:00',
  },
  {
    receipt_id: '22222222-2222-2222-2222-222222222222',
    original_filename: 'b.jpg',
    store_name: 'Store B',
    purchase_date: '2026-01-16',
    currency: 'USD',
    total: 20,
    created_at: '2026-01-16T00:00:00+00:00',
  },
  {
    receipt_id: '11111111-1111-1111-1111-111111111111',
    original_filename: 'a.jpg',
    store_name: 'Store A',
    purchase_date: '2026-01-15',
    currency: 'USD',
    total: 10,
    created_at: '2026-01-15T00:00:00+00:00',
  },
]

describe('ReceiptHistory', () => {
  let fetchSpy: jest.Mock

  beforeEach(() => {
    fetchSpy = jest.fn()
    global.fetch = fetchSpy as unknown as typeof fetch
  })

  afterEach(() => {
    // @ts-expect-error cleaning up the test-only global fetch stub
    delete global.fetch
  })

  test('three items are shown in the given (server) order', async () => {
    // Given the server returns three receipts, newest first
    fetchSpy.mockResolvedValue(jsonResponse(200, { items: THREE_ITEMS, count: 3 }))

    // When the history view is rendered
    render(<ReceiptHistory />)

    // Then three rows are shown in the same order the server returned them
    await waitFor(() => {
      expect(screen.getByText('Store C')).toBeInTheDocument()
    })
    const rows = screen.getAllByRole('button')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Store C')
    expect(rows[1]).toHaveTextContent('Store B')
    expect(rows[2]).toHaveTextContent('Store A')
  })

  test('empty list -> empty-state message shown', async () => {
    // Given the server has no saved receipts
    fetchSpy.mockResolvedValue(jsonResponse(200, { items: [], count: 0 }))

    // When the history view is rendered
    render(<ReceiptHistory />)

    // Then the empty-state message is shown
    await waitFor(() => {
      expect(
        screen.getByText('No receipts yet. Upload your first receipt.'),
      ).toBeInTheDocument()
    })
  })

  test('item with null store, date and total -> "Not detected" shown, no null/undefined/NaN text', async () => {
    // Given a saved receipt with every nullable field null
    fetchSpy.mockResolvedValue(
      jsonResponse(200, {
        items: [
          {
            receipt_id: '11111111-1111-1111-1111-111111111111',
            original_filename: null,
            store_name: null,
            purchase_date: null,
            currency: null,
            total: null,
            created_at: '2026-01-15T00:00:00+00:00',
          },
        ],
        count: 1,
      }),
    )

    // When the history view is rendered
    render(<ReceiptHistory />)

    // Then "Not detected" is shown for every missing field, with no raw null/undefined/NaN text
    await waitFor(() => {
      expect(screen.getAllByText('Not detected').length).toBeGreaterThan(0)
    })
    expect(document.body.textContent).not.toMatch(/\bnull\b/i)
    expect(document.body.textContent).not.toMatch(/\bundefined\b/i)
    expect(document.body.textContent).not.toMatch(/\bNaN\b/i)
  })

  test('loading state is shown while the request is pending', async () => {
    // Given the list request has not resolved yet
    const deferred = createDeferred<unknown>()
    fetchSpy.mockReturnValue(deferred.promise)

    // When the history view is rendered
    render(<ReceiptHistory />)

    // Then "Loading receipts..." is shown
    expect(screen.getByText('Loading receipts...')).toBeInTheDocument()

    // Cleanup
    deferred.resolve(jsonResponse(200, { items: [], count: 0 }))
    await waitFor(() =>
      expect(screen.getByText('No receipts yet. Upload your first receipt.')).toBeInTheDocument(),
    )
  })

  test('error response -> error shown, Retry calls the list again', async () => {
    // Given the server returns an error
    let callCount = 0
    fetchSpy.mockImplementation(() => {
      callCount += 1
      if (callCount === 1) {
        return Promise.resolve(jsonResponse(500, { detail: 'Internal error' }))
      }
      return Promise.resolve(jsonResponse(200, { items: THREE_ITEMS, count: 3 }))
    })
    const user = userEvent.setup()

    // When the history view is rendered
    render(<ReceiptHistory />)

    // Then an error message with a Retry button is shown
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Could not load receipt history. Please try again.',
      )
    })

    // When the user clicks Retry
    await user.click(screen.getByRole('button', { name: /retry/i }))

    // Then the list is requested again and shown
    await waitFor(() => {
      expect(screen.getByText('Store C')).toBeInTheDocument()
    })
    expect(callCount).toBe(2)
  })

  test('network failure -> error shown, Retry calls the list again', async () => {
    // Given the list request fails outright
    let callCount = 0
    fetchSpy.mockImplementation(() => {
      callCount += 1
      if (callCount === 1) {
        return Promise.reject(new TypeError('Failed to fetch'))
      }
      return Promise.resolve(jsonResponse(200, { items: [], count: 0 }))
    })
    const user = userEvent.setup()

    // When the history view is rendered
    render(<ReceiptHistory />)

    // Then a network error message is shown
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Could not reach the server. Please try again.',
      )
    })

    // When the user clicks Retry
    await user.click(screen.getByRole('button', { name: /retry/i }))

    // Then the list is requested again
    await waitFor(() => {
      expect(screen.getByText('No receipts yet. Upload your first receipt.')).toBeInTheDocument()
    })
    expect(callCount).toBe(2)
  })
})
