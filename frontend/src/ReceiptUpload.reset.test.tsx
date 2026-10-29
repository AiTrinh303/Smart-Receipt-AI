import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReceiptUpload from './ReceiptUpload'

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

const EDITED_RECEIPT = {
  receipt_id: VALID_UUID,
  store_name: 'Edited Store',
  purchase_date: '2026-01-16',
  currency: 'USD',
  items: [],
  discounts: [],
  taxes: [],
  total: 8.64,
  warnings: [],
  edited: true,
  edited_at: '2026-01-16T09:00:00+00:00',
  original_filename: 'receipt.jpg',
  content_type: 'image/jpeg',
  created_at: '2026-01-15T10:00:00+00:00',
  updated_at: '2026-01-16T09:00:00+00:00',
}

const AI_RECEIPT = {
  ...EDITED_RECEIPT,
  store_name: 'Corner Store',
  purchase_date: '2026-01-15',
  edited: false,
  edited_at: null,
  updated_at: '2026-01-16T10:00:00+00:00',
}

const UNEDITED_RECEIPT = { ...AI_RECEIPT }

function routeFetch(
  fetchSpy: jest.Mock,
  routes: { get?: () => Promise<unknown>; reset?: () => Promise<unknown> },
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
    if (urlString.endsWith('/reset') && method === 'POST') {
      return routes.reset
        ? routes.reset()
        : Promise.reject(new Error(`Unexpected reset call to ${urlString}`))
    }
    if (method === 'GET' && urlString.includes('/receipts/')) {
      return routes.get
        ? routes.get()
        : Promise.reject(new Error(`Unexpected GET call to ${urlString}`))
    }
    return Promise.reject(new Error(`Unexpected fetch call to ${urlString}`))
  })
}

async function openEditedReceipt(fetchSpy: jest.Mock) {
  window.history.replaceState({}, '', `/?receipt=${VALID_UUID}`)
  routeFetch(fetchSpy, { get: () => Promise.resolve(jsonResponse(200, EDITED_RECEIPT)) })
  render(<ReceiptUpload />)
  await waitFor(() => {
    expect(screen.getByText('Edited Store')).toBeInTheDocument()
  })
}

describe('resetting a receipt to its AI result', () => {
  let fetchSpy: jest.Mock

  beforeEach(() => {
    fetchSpy = jest.fn()
    global.fetch = fetchSpy as unknown as typeof fetch
  })

  afterEach(() => {
    // @ts-expect-error cleaning up the test-only global fetch stub
    delete global.fetch
  })

  test('"Reset to AI result" button is shown only when edited is true', async () => {
    // Given an edited receipt is open
    await openEditedReceipt(fetchSpy)
    expect(screen.getByRole('button', { name: /reset to ai result/i })).toBeInTheDocument()
  })

  test('no "Reset to AI result" button when edited is false', async () => {
    // Given an unedited receipt is open
    window.history.replaceState({}, '', `/?receipt=${VALID_UUID}`)
    routeFetch(fetchSpy, { get: () => Promise.resolve(jsonResponse(200, UNEDITED_RECEIPT)) })
    render(<ReceiptUpload />)
    await waitFor(() => {
      expect(screen.getByText('Corner Store')).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { name: /reset to ai result/i })).not.toBeInTheDocument()
  })

  test('clicking it shows a confirmation and sends no request until "Yes, reset"', async () => {
    // Given an edited receipt is open
    await openEditedReceipt(fetchSpy)
    const user = userEvent.setup()

    // When the user clicks "Reset to AI result"
    await user.click(screen.getByRole('button', { name: /reset to ai result/i }))

    // Then the confirmation is shown and no reset request was sent yet
    expect(
      screen.getByText('Replace your edits with the original AI result? This cannot be undone.'),
    ).toBeInTheDocument()
    expect(fetchSpy.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  test('Cancel sends no request and keeps the current data', async () => {
    // Given the reset confirmation is shown
    await openEditedReceipt(fetchSpy)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /reset to ai result/i }))

    // When the user clicks Cancel
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))

    // Then no POST was sent and the edited data is still shown
    expect(fetchSpy.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
    expect(screen.getByText('Edited Store')).toBeInTheDocument()
  })

  test('confirming sends exactly one POST and updates the view from the response', async () => {
    // Given the reset confirmation is shown and the server will accept it
    await openEditedReceipt(fetchSpy)
    routeFetch(fetchSpy, {
      get: () => Promise.resolve(jsonResponse(200, EDITED_RECEIPT)),
      reset: () => Promise.resolve(jsonResponse(200, AI_RECEIPT)),
    })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /reset to ai result/i }))

    // When the user clicks "Yes, reset"
    await user.click(screen.getByRole('button', { name: /yes, reset/i }))

    // Then exactly one POST request is sent to the reset endpoint
    await waitFor(() => {
      expect(fetchSpy.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
    })
    const resetCall = fetchSpy.mock.calls.find(([, options]) => options?.method === 'POST')
    expect(resetCall?.[0]).toBe(`http://localhost:8001/receipts/${VALID_UUID}/reset`)

    // And the view updates to the restored (AI) data straight from the response
    await waitFor(() => {
      expect(screen.getByText('Corner Store')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /reset to ai result/i })).not.toBeInTheDocument()
  })

  test('while pending, "Resetting..." is shown and buttons are disabled', async () => {
    // Given the reset confirmation is shown and the request has not resolved yet
    await openEditedReceipt(fetchSpy)
    let resolveReset!: (value: unknown) => void
    const deferred = new Promise((resolve) => {
      resolveReset = resolve
    })
    routeFetch(fetchSpy, {
      get: () => Promise.resolve(jsonResponse(200, EDITED_RECEIPT)),
      reset: () => deferred,
    })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /reset to ai result/i }))

    // When the user clicks "Yes, reset"
    await user.click(screen.getByRole('button', { name: /yes, reset/i }))

    // Then the button shows "Resetting..." and Cancel is disabled
    const resettingButton = screen.getByRole('button', { name: /resetting/i })
    expect(resettingButton).toBeDisabled()
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeDisabled()

    // Cleanup
    resolveReset(jsonResponse(200, AI_RECEIPT))
    await waitFor(() => expect(screen.queryByText('Resetting...')).not.toBeInTheDocument())
  })

  test('failure keeps the current data and allows retrying', async () => {
    // Given the first reset attempt fails
    await openEditedReceipt(fetchSpy)
    let callCount = 0
    routeFetch(fetchSpy, {
      get: () => Promise.resolve(jsonResponse(200, EDITED_RECEIPT)),
      reset: () => {
        callCount += 1
        if (callCount === 1) {
          return Promise.resolve(jsonResponse(500, { detail: 'Could not reset the receipt. Please try again.' }))
        }
        return Promise.resolve(jsonResponse(200, AI_RECEIPT))
      },
    })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /reset to ai result/i }))
    await user.click(screen.getByRole('button', { name: /yes, reset/i }))

    // Then an error is shown and the edited data is still visible
    await waitFor(() => {
      expect(screen.getByText('Could not reset the receipt. Please try again.')).toBeInTheDocument()
    })
    expect(screen.getByText('Edited Store')).toBeInTheDocument()

    // When the user tries again
    await user.click(screen.getByRole('button', { name: /yes, reset/i }))

    // Then a second POST is sent and succeeds
    await waitFor(() => expect(callCount).toBe(2))
    await waitFor(() => {
      expect(screen.getByText('Corner Store')).toBeInTheDocument()
    })
  })

  test('the extract and PUT endpoints are never called during reset', async () => {
    // Given the reset confirmation is shown and the server accepts it
    await openEditedReceipt(fetchSpy)
    routeFetch(fetchSpy, {
      get: () => Promise.resolve(jsonResponse(200, EDITED_RECEIPT)),
      reset: () => Promise.resolve(jsonResponse(200, AI_RECEIPT)),
    })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /reset to ai result/i }))
    await user.click(screen.getByRole('button', { name: /yes, reset/i }))

    await waitFor(() => {
      expect(screen.getByText('Corner Store')).toBeInTheDocument()
    })

    // Then no call was ever made to extract or with method PUT (routeFetch
    // itself rejects both, so a passing test proves neither fired)
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/extract'))).toBe(false)
    expect(fetchSpy.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false)
  })
})

describe('after a successful Save, the response\'s edited badge and warnings appear', () => {
  let fetchSpy: jest.Mock

  beforeEach(() => {
    fetchSpy = jest.fn()
    global.fetch = fetchSpy as unknown as typeof fetch
  })

  afterEach(() => {
    // @ts-expect-error cleaning up the test-only global fetch stub
    delete global.fetch
  })

  test('Save shows the Edited badge and the fresh warnings from the PUT response', async () => {
    // Given a saved, unedited receipt is open
    window.history.replaceState({}, '', `/?receipt=${VALID_UUID}`)
    fetchSpy.mockImplementation((url: unknown, options?: RequestInit) => {
      const urlString = String(url)
      const method = options?.method ?? 'GET'
      if (method === 'GET' && urlString.includes('/receipts/')) {
        return Promise.resolve(jsonResponse(200, UNEDITED_RECEIPT))
      }
      if (method === 'PUT') {
        return Promise.resolve(
          jsonResponse(200, {
            ...UNEDITED_RECEIPT,
            store_name: 'Fixed Store',
            total: 999,
            edited: true,
            edited_at: '2026-01-17T00:00:00+00:00',
            warnings: [
              { code: 'TOTAL_MISMATCH', field: 'total', message: 'The total looks off.', details: {} },
            ],
          }),
        )
      }
      return Promise.reject(new Error(`Unexpected fetch call to ${urlString}`))
    })
    const user = userEvent.setup()
    render(<ReceiptUpload />)
    await waitFor(() => {
      expect(screen.getByText('Corner Store')).toBeInTheDocument()
    })

    // When the user edits and saves
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    // Then the Edited badge and the new warning both appear
    await waitFor(() => {
      expect(screen.getByText('Fixed Store')).toBeInTheDocument()
    })
    expect(screen.getByText('Edited')).toBeInTheDocument()
    expect(screen.getByText('The total looks off.')).toBeInTheDocument()
  })
})
