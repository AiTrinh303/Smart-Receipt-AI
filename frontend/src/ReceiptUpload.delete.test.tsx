import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

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
  warnings: [],
  edited: false,
  edited_at: null,
  original_filename: 'receipt.jpg',
  content_type: 'image/jpeg',
  created_at: '2026-01-15T10:00:00+00:00',
  updated_at: '2026-01-15T10:00:00+00:00',
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function routeFetch(
  fetchSpy: jest.Mock,
  routes: {
    get?: () => Promise<unknown>
    list?: () => Promise<unknown>
    del?: () => Promise<unknown>
  },
) {
  fetchSpy.mockImplementation((url: unknown, options?: RequestInit) => {
    const urlString = String(url)
    const method = options?.method ?? 'GET'

    if (urlString.includes('/extract')) {
      return Promise.reject(new Error(`Unexpected extract call to ${urlString}`))
    }
    if (method === 'PUT') {
      return Promise.reject(new Error(`Unexpected PUT call to ${urlString}`))
    }
    if (method === 'DELETE') {
      return routes.del
        ? routes.del()
        : Promise.reject(new Error(`Unexpected DELETE call to ${urlString}`))
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

async function openSavedReceipt(fetchSpy: jest.Mock) {
  window.history.replaceState({}, '', `/?receipt=${VALID_UUID}`)
  routeFetch(fetchSpy, { get: () => Promise.resolve(jsonResponse(200, SAVED_RECEIPT)) })
  render(<App />)
  await waitFor(() => {
    expect(screen.getByText('Corner Store')).toBeInTheDocument()
  })
}

describe('deleting a saved receipt', () => {
  let fetchSpy: jest.Mock

  beforeEach(() => {
    fetchSpy = jest.fn()
    global.fetch = fetchSpy as unknown as typeof fetch
  })

  afterEach(() => {
    // @ts-expect-error cleaning up the test-only global fetch stub
    delete global.fetch
  })

  test('Delete button is shown on a saved receipt and hidden in the edit form', async () => {
    // Given a saved receipt is open
    await openSavedReceipt(fetchSpy)
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument()

    // When the user opens the edit form
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^edit$/i }))

    // Then the Delete button is no longer shown
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument()
  })

  test('clicking Delete shows the confirmation and sends no request', async () => {
    // Given a saved receipt is open
    await openSavedReceipt(fetchSpy)
    const user = userEvent.setup()

    // When the user clicks Delete
    await user.click(screen.getByRole('button', { name: /^delete$/i }))

    // Then the confirmation prompt is shown and no request was sent
    expect(
      screen.getByText(
        'Delete this receipt? This removes the saved data and the uploaded file from this app. This cannot be undone.',
      ),
    ).toBeInTheDocument()
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes(VALID_UUID))).toHaveLength(1) // only the initial GET
  })

  test('Cancel sends no request and the receipt is still shown', async () => {
    // Given the delete confirmation is shown
    await openSavedReceipt(fetchSpy)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^delete$/i }))

    // When the user clicks Cancel
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))

    // Then no DELETE was sent and the receipt is still shown
    expect(fetchSpy.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false)
    expect(screen.getByText('Corner Store')).toBeInTheDocument()
  })

  test('Confirm sends exactly one DELETE, then history shows "Receipt deleted." without that receipt', async () => {
    // Given the delete confirmation is shown and the server will accept the deletion
    await openSavedReceipt(fetchSpy)
    routeFetch(fetchSpy, {
      get: () => Promise.resolve(jsonResponse(200, SAVED_RECEIPT)),
      del: () => Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) }),
      list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0 })),
    })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^delete$/i }))

    // When the user clicks "Yes, delete"
    await user.click(screen.getByRole('button', { name: /yes, delete/i }))

    // Then exactly one DELETE request was sent to /receipts/<id>
    await waitFor(() => {
      expect(fetchSpy.mock.calls.filter(([, options]) => options?.method === 'DELETE')).toHaveLength(1)
    })
    const deleteCall = fetchSpy.mock.calls.find(([, options]) => options?.method === 'DELETE')
    expect(deleteCall?.[0]).toBe(`http://localhost:8001/receipts/${VALID_UUID}`)

    // And the history view shows "Receipt deleted.", with the mocked (empty) list not containing it
    await waitFor(() => {
      expect(screen.getByText('Receipt deleted.')).toBeInTheDocument()
    })
    expect(window.location.search).toBe('?view=history')
    expect(screen.queryByText('Corner Store')).not.toBeInTheDocument()
  })

  test('while deleting -> "Deleting..." shown and buttons disabled', async () => {
    // Given the delete confirmation is shown and the DELETE request has not resolved yet
    await openSavedReceipt(fetchSpy)
    const deferred = createDeferred<unknown>()
    routeFetch(fetchSpy, {
      get: () => Promise.resolve(jsonResponse(200, SAVED_RECEIPT)),
      del: () => deferred.promise,
    })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^delete$/i }))

    // When the user clicks "Yes, delete"
    await user.click(screen.getByRole('button', { name: /yes, delete/i }))

    // Then the button shows "Deleting..." and both buttons are disabled
    const deletingButton = screen.getByRole('button', { name: /deleting/i })
    expect(deletingButton).toBeDisabled()
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeDisabled()

    // Cleanup
    deferred.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) })
    await waitFor(() => expect(screen.queryByText('Deleting...')).not.toBeInTheDocument())
  })

  test('404 on delete -> history view shows "This receipt no longer exists."', async () => {
    // Given the receipt was already deleted elsewhere, so the DELETE call returns 404
    await openSavedReceipt(fetchSpy)
    routeFetch(fetchSpy, {
      get: () => Promise.resolve(jsonResponse(200, SAVED_RECEIPT)),
      del: () => Promise.resolve(jsonResponse(404, { detail: 'Receipt not found.' })),
      list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0 })),
    })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^delete$/i }))

    // When the user clicks "Yes, delete"
    await user.click(screen.getByRole('button', { name: /yes, delete/i }))

    // Then the history view shows the "no longer exists" notice
    await waitFor(() => {
      expect(screen.getByText('This receipt no longer exists.')).toBeInTheDocument()
    })
    expect(window.location.search).toBe('?view=history')
  })

  test('500 on delete -> error shown, receipt still visible, a second attempt sends another DELETE', async () => {
    // Given the first DELETE attempt fails with a server error
    await openSavedReceipt(fetchSpy)
    let callCount = 0
    routeFetch(fetchSpy, {
      get: () => Promise.resolve(jsonResponse(200, SAVED_RECEIPT)),
      del: () => {
        callCount += 1
        if (callCount === 1) {
          return Promise.resolve(jsonResponse(500, { detail: 'Could not delete the receipt. Please try again.' }))
        }
        return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) })
      },
    })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    await user.click(screen.getByRole('button', { name: /yes, delete/i }))

    // Then an error is shown and the receipt is still visible
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not delete the receipt. Please try again.')
    })
    expect(screen.getByText('Corner Store')).toBeInTheDocument()

    // When the user tries again
    await user.click(screen.getByRole('button', { name: /yes, delete/i }))

    // Then a second DELETE request is sent
    await waitFor(() => expect(callCount).toBe(2))
  })

  test('network failure on delete -> error shown, receipt still visible, a second attempt sends another DELETE', async () => {
    // Given the first DELETE attempt fails outright
    await openSavedReceipt(fetchSpy)
    let callCount = 0
    routeFetch(fetchSpy, {
      get: () => Promise.resolve(jsonResponse(200, SAVED_RECEIPT)),
      del: () => {
        callCount += 1
        if (callCount === 1) {
          return Promise.reject(new TypeError('Failed to fetch'))
        }
        return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) })
      },
    })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    await user.click(screen.getByRole('button', { name: /yes, delete/i }))

    // Then a network error is shown and the receipt is still visible
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not reach the server. Please try again.')
    })
    expect(screen.getByText('Corner Store')).toBeInTheDocument()

    // When the user tries again
    await user.click(screen.getByRole('button', { name: /yes, delete/i }))

    // Then a second DELETE request is sent
    await waitFor(() => expect(callCount).toBe(2))
  })

  test('the extract and PUT endpoints are never called during delete', async () => {
    // Given a saved receipt and a successful deletion
    await openSavedReceipt(fetchSpy)
    routeFetch(fetchSpy, {
      get: () => Promise.resolve(jsonResponse(200, SAVED_RECEIPT)),
      del: () => Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) }),
      list: () => Promise.resolve(jsonResponse(200, { items: [], count: 0 })),
    })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    await user.click(screen.getByRole('button', { name: /yes, delete/i }))

    await waitFor(() => {
      expect(screen.getByText('Receipt deleted.')).toBeInTheDocument()
    })

    // Then no call was ever made to extract or with method PUT (the routeFetch
    // helper itself rejects both, so a passing test proves neither fired)
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/extract'))).toBe(false)
    expect(fetchSpy.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false)
  })
})
