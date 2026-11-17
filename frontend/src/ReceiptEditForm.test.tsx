import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReceiptEditForm from './ReceiptEditForm'
import type { ReceiptExtraction } from './api/types'

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

const RECEIPT_ID = '11111111-1111-1111-1111-111111111111'

const SAMPLE_DATA: ReceiptExtraction = {
  receipt_id: RECEIPT_ID,
  store_name: 'Corner Store',
  purchase_date: '2026-01-15',
  currency: 'USD',
  items: [{ name: 'Milk', quantity: 1, unit_price: 2.5, line_total: 2.5 }],
  discounts: [],
  taxes: [],
  total: 2.5,
}

const NULL_DATA: ReceiptExtraction = {
  receipt_id: RECEIPT_ID,
  store_name: null,
  purchase_date: null,
  currency: null,
  items: [],
  discounts: [],
  taxes: [],
  total: null,
}

describe('ReceiptEditForm', () => {
  let fetchSpy: jest.Mock

  beforeEach(() => {
    fetchSpy = jest.fn()
    global.fetch = fetchSpy as unknown as typeof fetch
  })

  afterEach(() => {
    // @ts-expect-error cleaning up the test-only global fetch stub
    delete global.fetch
  })

  test('opens prefilled with the current values', () => {
    // Given a receipt with known values
    // When the edit form is rendered
    render(<ReceiptEditForm receiptId={RECEIPT_ID} data={SAMPLE_DATA} onSave={jest.fn()} onCancel={jest.fn()} />)

    // Then every field is prefilled with the current data
    expect(screen.getByDisplayValue('Corner Store')).toBeInTheDocument()
    expect(screen.getByDisplayValue('2026-01-15')).toBeInTheDocument()
    expect(screen.getByDisplayValue('USD')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Milk')).toBeInTheDocument()
    expect(screen.getByLabelText('Total')).toHaveValue('2.5')
  })

  test('change store name and total, Save -> exactly one PUT with only editable fields', async () => {
    // Given the edit form is open and the server will accept the update
    fetchSpy.mockResolvedValue(
      jsonResponse(200, { ...SAMPLE_DATA, store_name: 'Fixed Store', total: 99 }),
    )
    const onSave = jest.fn()
    const user = userEvent.setup()
    render(<ReceiptEditForm receiptId={RECEIPT_ID} data={SAMPLE_DATA} onSave={onSave} onCancel={jest.fn()} />)

    // When the user changes store name and total, then clicks Save
    const storeInput = screen.getByDisplayValue('Corner Store')
    await user.clear(storeInput)
    await user.type(storeInput, 'Fixed Store')
    const totalInput = screen.getByLabelText('Total')
    await user.clear(totalInput)
    await user.type(totalInput, '99')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    // Then exactly one PUT request is sent with only the editable fields
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    const [url, options] = fetchSpy.mock.calls[0]
    expect(url).toBe(`http://localhost:8001/receipts/${RECEIPT_ID}`)
    expect(options.method).toBe('PUT')
    const sentBody = JSON.parse(options.body)
    expect(sentBody).toEqual({
      store_name: 'Fixed Store',
      purchase_date: '2026-01-15',
      currency: 'USD',
      items: [{ name: 'Milk', quantity: 1, unit_price: 2.5, line_total: 2.5 }],
      discounts: [],
      taxes: [],
      total: 99,
    })
    expect(sentBody).not.toHaveProperty('receipt_id')
    expect(sentBody).not.toHaveProperty('created_at')
    expect(sentBody).not.toHaveProperty('original_filename')

    // And the new values are passed back to the caller
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ store_name: 'Fixed Store' })))
  })

  test('Cancel after typing -> no PUT call, onCancel is invoked', async () => {
    // Given the edit form is open
    const onCancel = jest.fn()
    const user = userEvent.setup()
    render(<ReceiptEditForm receiptId={RECEIPT_ID} data={SAMPLE_DATA} onSave={jest.fn()} onCancel={onCancel} />)

    // When the user types a change and then clicks Cancel
    const storeInput = screen.getByDisplayValue('Corner Store')
    await user.type(storeInput, ' edited')
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    // Then no request was sent, and the cancel callback fired
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  test('non-numeric amount -> inline error, no PUT call', async () => {
    // Given the edit form is open
    const user = userEvent.setup()
    render(<ReceiptEditForm receiptId={RECEIPT_ID} data={SAMPLE_DATA} onSave={jest.fn()} onCancel={jest.fn()} />)

    // When the user types a non-numeric total and clicks Save
    const totalInput = screen.getByLabelText('Total')
    await user.clear(totalInput)
    await user.type(totalInput, 'abc')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    // Then an inline error is shown and no request was sent
    expect(await screen.findByText('Must be a number.')).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('server returns 422 -> readable messages shown, form content kept', async () => {
    // Given the edit form is open and the server rejects the update
    fetchSpy.mockResolvedValue(
      jsonResponse(422, {
        detail: [{ loc: ['body', 'purchase_date'], msg: 'purchase_date must be null or a valid ISO date (YYYY-MM-DD).' }],
      }),
    )
    const user = userEvent.setup()
    render(<ReceiptEditForm receiptId={RECEIPT_ID} data={SAMPLE_DATA} onSave={jest.fn()} onCancel={jest.fn()} />)

    // When the user clicks Save
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    // Then a readable message is shown and the typed values are kept
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'purchase_date must be null or a valid ISO date (YYYY-MM-DD).',
      )
    })
    expect(screen.getByDisplayValue('Corner Store')).toBeInTheDocument()
  })

  test('network failure -> error shown, typed values kept, Save works again', async () => {
    // Given the edit form is open and the first save attempt fails outright
    let callCount = 0
    fetchSpy.mockImplementation(() => {
      callCount += 1
      if (callCount === 1) {
        return Promise.reject(new TypeError('Failed to fetch'))
      }
      return Promise.resolve(jsonResponse(200, SAMPLE_DATA))
    })
    const onSave = jest.fn()
    const user = userEvent.setup()
    render(<ReceiptEditForm receiptId={RECEIPT_ID} data={SAMPLE_DATA} onSave={onSave} onCancel={jest.fn()} />)

    // When the user clicks Save and it fails
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not reach the server. Please try again.')
    })
    expect(screen.getByDisplayValue('Corner Store')).toBeInTheDocument()

    // When the user clicks Save again
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    // Then it succeeds this time
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(callCount).toBe(2)
  })

  test('while saving -> button shows "Saving..." and is disabled', async () => {
    // Given the edit form is open and the save request has not resolved yet
    const deferred = createDeferred<unknown>()
    fetchSpy.mockReturnValue(deferred.promise)
    const user = userEvent.setup()
    render(<ReceiptEditForm receiptId={RECEIPT_ID} data={SAMPLE_DATA} onSave={jest.fn()} onCancel={jest.fn()} />)

    // When the user clicks Save
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    // Then the button shows "Saving..." and is disabled
    const button = screen.getByRole('button', { name: /saving/i })
    expect(button).toBeDisabled()

    // Cleanup
    deferred.resolve(jsonResponse(200, SAMPLE_DATA))
    await waitFor(() => expect(screen.queryByText('Saving...')).not.toBeInTheDocument())
  })

  test('null fields prefill as empty and are sent as null; empty lists work', async () => {
    // Given a receipt with every nullable field null and no items/discounts/taxes
    fetchSpy.mockResolvedValue(jsonResponse(200, NULL_DATA))
    const user = userEvent.setup()
    render(<ReceiptEditForm receiptId={RECEIPT_ID} data={NULL_DATA} onSave={jest.fn()} onCancel={jest.fn()} />)

    // Then the text fields are prefilled empty
    expect(screen.getByLabelText('Total')).toHaveValue('')

    // When the user saves without changing anything
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    // Then the request body sends null for every empty field and empty arrays
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    const [, options] = fetchSpy.mock.calls[0]
    const sentBody = JSON.parse(options.body)
    expect(sentBody).toEqual({
      store_name: null,
      purchase_date: null,
      currency: null,
      items: [],
      discounts: [],
      taxes: [],
      total: null,
    })
  })

  test('add and remove an item row', async () => {
    // Given the edit form is open with one item
    const user = userEvent.setup()
    render(<ReceiptEditForm receiptId={RECEIPT_ID} data={SAMPLE_DATA} onSave={jest.fn()} onCancel={jest.fn()} />)
    expect(screen.getByLabelText('Item 1 name')).toBeInTheDocument()
    expect(screen.queryByLabelText('Item 2 name')).not.toBeInTheDocument()

    // When the user adds an item row
    await user.click(screen.getByRole('button', { name: /add item/i }))

    // Then a second item row appears
    await waitFor(() => {
      expect(screen.getByLabelText('Item 2 name')).toBeInTheDocument()
    })

    // When the user removes the first item row
    await user.click(screen.getByRole('button', { name: /remove item 1/i }))

    // Then only the second row remains (now re-indexed as item 1)
    await waitFor(() => {
      expect(screen.queryByLabelText('Item 2 name')).not.toBeInTheDocument()
    })
    expect(screen.getByLabelText('Item 1 name')).toBeInTheDocument()
  })

  test('a date with no leading ISO date at all shows the "Original: ..." hint', () => {
    // Given the stored purchase_date cannot be parsed into a leading ISO date
    const data: ReceiptExtraction = { ...SAMPLE_DATA, purchase_date: '26/06/2025' }

    // When the edit form is rendered
    render(<ReceiptEditForm receiptId={RECEIPT_ID} data={data} onSave={jest.fn()} onCancel={jest.fn()} />)

    // Then the "Original: ..." hint is shown
    expect(screen.getByText('Original: 26/06/2025')).toBeInTheDocument()
  })

  test('a date with a leading ISO date prefills the date field with it, not the raw text', () => {
    // Given the stored purchase_date starts with a valid ISO date but has a
    // stray time suffix (e.g. "2025-06-26 11") -- never the raw text, which
    // the server would reject as purchase_date
    const data: ReceiptExtraction = { ...SAMPLE_DATA, purchase_date: '2025-06-26 11' }

    // When the edit form is rendered
    render(<ReceiptEditForm receiptId={RECEIPT_ID} data={data} onSave={jest.fn()} onCancel={jest.fn()} />)

    // Then the date field is prefilled with just the leading ISO date, and
    // there is no "Original: ..." hint
    expect(screen.getByDisplayValue('2025-06-26')).toBeInTheDocument()
    expect(screen.queryByText(/Original:/)).not.toBeInTheDocument()
  })

  test('the extract endpoint is never called during edit or save', async () => {
    // Given the edit form is open and the server accepts the update
    fetchSpy.mockResolvedValue(jsonResponse(200, SAMPLE_DATA))
    const user = userEvent.setup()
    render(<ReceiptEditForm receiptId={RECEIPT_ID} data={SAMPLE_DATA} onSave={jest.fn()} onCancel={jest.fn()} />)

    // When the user saves
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))

    // Then no call was ever made to the extract endpoint
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/extract'))).toBe(false)
  })
})

describe('focusField ("Fix in Edit")', () => {
  test('focusField="purchase_date" focuses the date input after mount', () => {
    render(
      <ReceiptEditForm
        receiptId={RECEIPT_ID}
        data={SAMPLE_DATA}
        onSave={jest.fn()}
        onCancel={jest.fn()}
        focusField="purchase_date"
      />,
    )

    expect(document.activeElement).toBe(screen.getByDisplayValue('2026-01-15'))
  })

  test('focusField="total" focuses the Total input after mount', () => {
    render(
      <ReceiptEditForm
        receiptId={RECEIPT_ID}
        data={SAMPLE_DATA}
        onSave={jest.fn()}
        onCancel={jest.fn()}
        focusField="total"
      />,
    )

    expect(document.activeElement).toBe(screen.getByLabelText('Total'))
  })

  test('no focusField leaves focus untouched', () => {
    render(<ReceiptEditForm receiptId={RECEIPT_ID} data={SAMPLE_DATA} onSave={jest.fn()} onCancel={jest.fn()} />)

    expect(document.activeElement).not.toBe(screen.getByLabelText('Total'))
    expect(document.activeElement).not.toBe(screen.getByDisplayValue('2026-01-15'))
  })
})
