import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ReceiptUpload from './ReceiptUpload'
import {
  EXTRACTION_FAILED_MESSAGE,
  EXTRACTION_NOT_CONFIGURED_MESSAGE,
  NETWORK_ERROR_MESSAGE,
} from './errorMessages'
import { mockObjectUrl } from './test/objectUrl'
import { SAMPLE_APARTMENTS, jsonResponse, withApartments } from './test/apartmentsFetch'

// This project's Jest setup transforms with esbuild directly (no
// babel-plugin-jest-hoist), so jest.mock() calls are never hoisted above
// imports -- every test file in this codebase mocks at the `fetch` boundary
// instead, so the real uploadReceipt/extractReceipt modules run underneath,
// against fully controllable (deferred) responses.

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

function makeFile(name: string, overrides: { type?: string; content?: string } = {}): File {
  const isPdf = name.toLowerCase().endsWith('.pdf')
  const type = overrides.type ?? (isPdf ? 'application/pdf' : 'image/jpeg')
  const content = overrides.content ?? (isPdf ? '%PDF-1.4 fake' : 'dummy')
  return new File([content], name, { type })
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

type Deferred = ReturnType<typeof createDeferred<unknown>>

let uploadDeferreds: Map<string, Deferred>
let extractDeferreds: Map<string, Deferred>
let fetchSpy: jest.Mock

beforeEach(() => {
  uploadDeferreds = new Map()
  extractDeferreds = new Map()

  fetchSpy = jest.fn().mockImplementation(
    withApartments((urlString: string, options?: RequestInit) => {
      if (urlString.endsWith('/receipts/upload')) {
        const file = (options!.body as FormData).get('file') as File
        const deferred = createDeferred<unknown>()
        uploadDeferreds.set(file.name, deferred)
        return deferred.promise
      }
      if (urlString.includes('/extract')) {
        const receiptId = urlString.split('/receipts/')[1].split('/extract')[0]
        const deferred = createDeferred<unknown>()
        extractDeferreds.set(receiptId, deferred)
        return deferred.promise
      }
      return Promise.reject(new Error(`Unexpected fetch call to ${urlString}`))
    }),
  )
  global.fetch = fetchSpy as unknown as typeof fetch
})
afterEach(() => {
  // @ts-expect-error cleaning up the test-only global fetch stub
  delete global.fetch
})

function uploadBody(receiptId: string, filename: string) {
  return { receipt_id: receiptId, filename, content_type: 'image/jpeg', size_bytes: 10 }
}

function extractionBody(receiptId: string, overrides: Record<string, unknown> = {}) {
  return {
    receipt_id: receiptId,
    store_name: 'Store',
    purchase_date: '2026-01-15',
    currency: 'USD',
    items: [],
    discounts: [],
    taxes: [],
    total: 10,
    warnings: [],
    edited: false,
    edited_at: null,
    apartment_id: null,
    apartment_name: null,
    status: 'needs_review',
    ...overrides,
  }
}

function resolveUpload(filename: string, receiptId: string) {
  uploadDeferreds.get(filename)!.resolve(jsonResponse(201, uploadBody(receiptId, filename)))
}

function resolveExtract(receiptId: string, overrides: Record<string, unknown> = {}) {
  extractDeferreds.get(receiptId)!.resolve(jsonResponse(200, extractionBody(receiptId, overrides)))
}

function getFileInput() {
  return screen.getByLabelText(/upload receipt/i)
}

function selectFiles(files: File[]) {
  fireEvent.change(getFileInput(), { target: { files } })
}

async function chooseApartment() {
  fireEvent.click(await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name }))
}

function getStartButton(count: number) {
  return screen.getByRole('button', { name: new RegExp(`read ${count} receipts`, 'i') })
}

test('Given one file is chosen, When it is selected, Then the single-file flow is used, not the batch panel', async () => {
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })

  selectFiles([makeFile('receipt.jpg')])

  await waitFor(() => expect(screen.getByText('Selected file: receipt.jpg')).toBeInTheDocument())
  expect(screen.getByRole('button', { name: /^read receipt$/i })).toBeInTheDocument()
})

test('Given the form is empty, When 3 files are chosen, Then 3 rows appear and the button reads "Read 3 receipts"', async () => {
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })

  selectFiles([makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg')])

  await waitFor(() => expect(screen.getByText('a.jpg')).toBeInTheDocument())
  expect(screen.getByText('b.jpg')).toBeInTheDocument()
  expect(screen.getByText('c.jpg')).toBeInTheDocument()
  expect(getStartButton(3)).toBeInTheDocument()
})

test('Given files are queued, When no apartment is chosen, Then the start button stays disabled with the usual helper text', async () => {
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })

  selectFiles([makeFile('a.jpg'), makeFile('b.jpg')])
  await waitFor(() => expect(getStartButton(2)).toBeDisabled())
  expect(screen.getByText('Choose an apartment to continue.')).toBeInTheDocument()

  await chooseApartment()
  expect(getStartButton(2)).toBeEnabled()
})

test('Given an apartment and 2 files, When Start is clicked, Then each file is uploaded with the chosen apartment_id and rows show status', async () => {
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })
  selectFiles([makeFile('a.jpg'), makeFile('b.jpg')])
  await chooseApartment()

  fireEvent.click(getStartButton(2))

  await waitFor(() => expect(uploadDeferreds.size).toBe(2))
  expect(screen.getAllByText('Uploading...')).toHaveLength(2)
  for (const call of fetchSpy.mock.calls) {
    const [url, options] = call
    if (String(url).endsWith('/receipts/upload')) {
      expect((options!.body as FormData).get('apartment_id')).toBe(SAMPLE_APARTMENTS[0].id)
    }
  }
})

test('Given 3 queued files, When started, Then at most 2 rows are in progress at once', async () => {
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })
  selectFiles([makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg')])
  await chooseApartment()
  fireEvent.click(getStartButton(3))

  await waitFor(() => expect(uploadDeferreds.size).toBe(2))
  expect(screen.getAllByText('Uploading...')).toHaveLength(2)
  expect(screen.getByText('Waiting')).toBeInTheDocument()
})

test('Given 2 running items, When one extract returns 502, Then that row shows Failed and the other finishes', async () => {
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })
  selectFiles([makeFile('a.jpg'), makeFile('b.jpg')])
  await chooseApartment()
  fireEvent.click(getStartButton(2))

  await waitFor(() => expect(uploadDeferreds.size).toBe(2))
  resolveUpload('a.jpg', 'ra')
  resolveUpload('b.jpg', 'rb')

  await waitFor(() => expect(extractDeferreds.size).toBe(2))
  extractDeferreds.get('ra')!.resolve(jsonResponse(502, { detail: 'boom' }))
  resolveExtract('rb')

  await waitFor(() => expect(screen.getByText('Failed')).toBeInTheDocument())
  expect(screen.getByText('Done')).toBeInTheDocument()
  expect(screen.getByText(EXTRACTION_FAILED_MESSAGE)).toBeInTheDocument()
})

test('Given a running batch with a file still waiting, When an extract returns 503, Then it pauses with the matching message and Resume continues the rest', async () => {
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })
  selectFiles([makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg')])
  await chooseApartment()
  fireEvent.click(getStartButton(3))

  await waitFor(() => expect(uploadDeferreds.size).toBe(2))
  resolveUpload('a.jpg', 'ra')
  resolveUpload('b.jpg', 'rb')
  await waitFor(() => expect(extractDeferreds.size).toBe(2))
  extractDeferreds.get('ra')!.resolve(jsonResponse(503, { detail: 'nope' }))
  resolveExtract('rb')

  // "c" is still waiting (blocked by the pause), so the batch isn't finished yet
  await waitFor(() => expect(screen.getAllByText(EXTRACTION_NOT_CONFIGURED_MESSAGE).length).toBeGreaterThan(0))
  expect(screen.getByText('Waiting')).toBeInTheDocument()
  const resumeButton = screen.getByRole('button', { name: /^resume$/i })

  fireEvent.click(resumeButton)
  await waitFor(() => expect(uploadDeferreds.has('c.jpg')).toBe(true))
  resolveUpload('c.jpg', 'rc')
  await waitFor(() => expect(extractDeferreds.has('rc')).toBe(true))
  resolveExtract('rc')

  await waitFor(() => expect(screen.getByText('Done: 2 read, 1 failed.')).toBeInTheDocument())
})

test('Given a failed row with a receiptId, When Retry is clicked, Then only extract is called again, not upload', async () => {
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })
  selectFiles([makeFile('a.jpg'), makeFile('b.jpg')])
  await chooseApartment()
  fireEvent.click(getStartButton(2))

  await waitFor(() => expect(uploadDeferreds.size).toBe(2))
  resolveUpload('a.jpg', 'ra')
  resolveUpload('b.jpg', 'rb')
  await waitFor(() => expect(extractDeferreds.size).toBe(2))
  extractDeferreds.get('ra')!.resolve(jsonResponse(502, { detail: 'boom' }))
  resolveExtract('rb')
  await waitFor(() => expect(screen.getByText('Failed')).toBeInTheDocument())

  const uploadCallsBefore = fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/receipts/upload')).length

  fireEvent.click(screen.getByRole('button', { name: /^retry$/i }))
  await waitFor(() => expect(extractDeferreds.size).toBe(2))
  // the retried item's extract deferred is re-created under the same receipt id
  resolveExtract('ra')

  await waitFor(() => expect(screen.getAllByText('Done')).toHaveLength(2))
  const uploadCallsAfter = fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/receipts/upload')).length
  expect(uploadCallsAfter).toBe(uploadCallsBefore)
})

test('Given a waiting file, When Remove is clicked, Then it disappears from the queue and the count updates', async () => {
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })
  selectFiles([makeFile('a.jpg'), makeFile('b.jpg')])

  await waitFor(() => expect(screen.getByText('a.jpg')).toBeInTheDocument())
  fireEvent.click(screen.getAllByRole('button', { name: /^remove$/i })[0])

  expect(screen.queryByText('a.jpg')).not.toBeInTheDocument()
  expect(getStartButton(1)).toBeInTheDocument()
})

test('Given one invalid file among valid ones, When chosen, Then the rejected file is listed with its reason', async () => {
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })

  selectFiles([makeFile('notes.txt', { type: 'text/plain' }), makeFile('a.jpg'), makeFile('b.jpg')])

  await waitFor(() =>
    expect(
      screen.getByText('notes.txt: Invalid file type. Please select a JPG, PNG, or PDF file.'),
    ).toBeInTheDocument(),
  )
})

test('Given a finished item, Then its Open link points at the receipt with safe target/rel attributes', async () => {
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })
  selectFiles([makeFile('a.jpg'), makeFile('b.jpg')])
  await chooseApartment()
  fireEvent.click(getStartButton(2))

  await waitFor(() => expect(uploadDeferreds.size).toBe(2))
  resolveUpload('a.jpg', 'ra')
  resolveUpload('b.jpg', 'rb')
  await waitFor(() => expect(extractDeferreds.size).toBe(2))
  resolveExtract('ra')
  resolveExtract('rb')

  await waitFor(() => expect(screen.getAllByText('Done')).toHaveLength(2))
  const openLink = screen.getAllByRole('link', { name: /^open$/i })[0] as HTMLAnchorElement
  expect(openLink).toHaveAttribute('href', '/?receipt=ra')
  expect(openLink).toHaveAttribute('target', '_blank')
  expect(openLink).toHaveAttribute('rel', 'noopener noreferrer')
})

test('Given a finished item with warnings, Then its row shows a "Check values" badge', async () => {
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })
  selectFiles([makeFile('a.jpg'), makeFile('b.jpg')])
  await chooseApartment()
  fireEvent.click(getStartButton(2))

  await waitFor(() => expect(uploadDeferreds.size).toBe(2))
  resolveUpload('a.jpg', 'ra')
  resolveUpload('b.jpg', 'rb')
  await waitFor(() => expect(extractDeferreds.size).toBe(2))
  resolveExtract('ra', {
    warnings: [{ code: 'MISSING_TOTAL', field: 'total', message: 'x', details: {} }],
  })
  resolveExtract('rb')

  await waitFor(() => expect(screen.getByText('Check values (1)')).toBeInTheDocument())
})

test('Given a batch that has finished, Then a summary alert shows and "Review in History" links to the apartment+needs_review filter', async () => {
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })
  selectFiles([makeFile('a.jpg'), makeFile('b.jpg')])
  await chooseApartment()
  fireEvent.click(getStartButton(2))

  await waitFor(() => expect(uploadDeferreds.size).toBe(2))
  resolveUpload('a.jpg', 'ra')
  uploadDeferreds.get('b.jpg')!.resolve(jsonResponse(400, { detail: 'bad file' }))
  await waitFor(() => expect(extractDeferreds.size).toBe(1))
  resolveExtract('ra')

  await waitFor(() => expect(screen.getByText('Done: 1 read, 1 failed.')).toBeInTheDocument())

  fireEvent.click(screen.getByRole('button', { name: /review in history/i }))
  expect(window.location.search).toBe(
    `?view=history&apartment=${SAMPLE_APARTMENTS[0].id}&status=needs_review`,
  )
})

test('Given a running batch, When Stop is clicked, Then it pauses with the stopped message and a Resume button', async () => {
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })
  selectFiles([makeFile('a.jpg'), makeFile('b.jpg')])
  await chooseApartment()
  fireEvent.click(getStartButton(2))

  await waitFor(() => expect(uploadDeferreds.size).toBe(2))
  fireEvent.click(screen.getByRole('button', { name: /^stop$/i }))

  expect(screen.getByText('Stopped. The remaining receipts were not processed.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^resume$/i })).toBeInTheDocument()
})

test('Given a batch is running, Then the apartment group and the dropzone are disabled', async () => {
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })
  selectFiles([makeFile('a.jpg'), makeFile('b.jpg')])
  await chooseApartment()
  fireEvent.click(getStartButton(2))

  await waitFor(() => expect(uploadDeferreds.size).toBe(2))
  expect(screen.getByRole('radio', { name: SAMPLE_APARTMENTS[0].name })).toBeDisabled()
  expect(screen.getByRole('button', { name: /drag a receipt here/i })).toHaveAttribute('aria-disabled', 'true')
  expect(getFileInput()).toBeDisabled()
})

test('Given a batch upload is in flight, Then a beforeunload handler is registered, and removed once nothing is in flight', async () => {
  const addSpy = jest.spyOn(window, 'addEventListener')
  const removeSpy = jest.spyOn(window, 'removeEventListener')

  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })
  expect(addSpy).not.toHaveBeenCalledWith('beforeunload', expect.any(Function))

  selectFiles([makeFile('a.jpg'), makeFile('b.jpg')])
  await chooseApartment()
  fireEvent.click(getStartButton(2))

  // registered once the first upload is actually in flight
  await waitFor(() => expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function)))

  resolveUpload('a.jpg', 'ra')
  resolveUpload('b.jpg', 'rb')
  await waitFor(() => expect(extractDeferreds.size).toBe(2))
  resolveExtract('ra')
  resolveExtract('rb')

  // removed again once both items have settled (nothing left in flight)
  await waitFor(() => expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function)))

  addSpy.mockRestore()
  removeSpy.mockRestore()
})
