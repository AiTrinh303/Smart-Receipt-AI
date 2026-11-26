import { act, renderHook, waitFor } from '@testing-library/react'
import { ApiError } from '../api/ApiError'
import type { ReceiptSummary } from '../api/types'
import {
  EXTRACTION_FAILED_MESSAGE,
  EXTRACTION_NOT_CONFIGURED_MESSAGE,
  NETWORK_ERROR_MESSAGE,
} from '../errorMessages'
import { MAX_BATCH } from './batchReducer'
import { useBatchUpload } from './useBatchUpload'

// This project's Jest setup transforms with esbuild directly (no
// babel-plugin-jest-hoist), so jest.mock() calls are never hoisted above
// imports and module-level mocking of ../api/uploadReceipt and
// ../api/extractReceipt doesn't work reliably. Every other test file in
// this codebase instead mocks at the `fetch` boundary -- this file does
// the same, so the REAL uploadReceipt/extractReceipt modules run, with
// fully controllable (deferred) responses underneath them.

const APARTMENT_ID = 'oberaudorf-bergblick'

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeFile(
  name: string,
  overrides: { type?: string; content?: string; lastModified?: number; size?: number } = {},
): File {
  const isPdf = name.toLowerCase().endsWith('.pdf')
  const type = overrides.type ?? (isPdf ? 'application/pdf' : 'image/jpeg')
  const content = overrides.content ?? (isPdf ? '%PDF-1.4 fake' : 'dummy')
  const file = new File([content], name, { type })
  if (overrides.lastModified !== undefined) {
    Object.defineProperty(file, 'lastModified', { value: overrides.lastModified })
  }
  if (overrides.size !== undefined) {
    Object.defineProperty(file, 'size', { value: overrides.size })
  }
  return file
}

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

type Deferred = ReturnType<typeof createDeferred<unknown>>

let fetchSpy: jest.Mock
let uploadDeferreds: Map<string, Deferred>
let extractDeferreds: Map<string, Deferred>
let uploadImpl: ((file: File) => Promise<unknown>) | null
let extractImpl: ((receiptId: string) => Promise<unknown>) | null

beforeEach(() => {
  uploadDeferreds = new Map()
  extractDeferreds = new Map()
  uploadImpl = null
  extractImpl = null

  fetchSpy = jest.fn().mockImplementation((url: unknown, options?: RequestInit) => {
    const urlString = String(url)

    if (urlString.endsWith('/receipts/upload')) {
      const file = (options!.body as FormData).get('file') as File
      if (uploadImpl) {
        return uploadImpl(file)
      }
      const deferred = createDeferred<unknown>()
      uploadDeferreds.set(file.name, deferred)
      return deferred.promise
    }

    if (urlString.includes('/extract')) {
      const receiptId = urlString.split('/receipts/')[1].split('/extract')[0]
      if (extractImpl) {
        return extractImpl(receiptId)
      }
      const deferred = createDeferred<unknown>()
      extractDeferreds.set(receiptId, deferred)
      return deferred.promise
    }

    return Promise.reject(new Error(`Unexpected fetch call to ${urlString}`))
  })
  global.fetch = fetchSpy as unknown as typeof fetch
})

afterEach(() => {
  // @ts-expect-error cleaning up the test-only global fetch stub
  delete global.fetch
})

function resolveUpload(filename: string, receiptId: string) {
  uploadDeferreds.get(filename)!.resolve(jsonResponse(201, uploadBody(receiptId, filename)))
}

function resolveExtract(receiptId: string, overrides: Record<string, unknown> = {}) {
  extractDeferreds.get(receiptId)!.resolve(jsonResponse(200, extractionBody(receiptId, overrides)))
}

// --- Concurrency -----------------------------------------------------------

test('never more than CONCURRENCY (2) items are in flight, and all 5 reach done', async () => {
  const { result } = renderHook(() => useBatchUpload())
  const files = Array.from({ length: 5 }, (_, i) => makeFile(`receipt${i}.jpg`))
  await act(async () => {
    await result.current.addFiles(files)
  })

  act(() => {
    result.current.start(APARTMENT_ID)
  })

  await waitFor(() => {
    expect(result.current.items.filter((i) => i.status === 'uploading')).toHaveLength(2)
  })
  expect(result.current.items.filter((i) => i.status === 'waiting')).toHaveLength(3)

  for (let i = 0; i < 5; i += 1) {
    const fileName = `receipt${i}.jpg`
    await waitFor(() => expect(uploadDeferreds.has(fileName)).toBe(true))
    act(() => {
      resolveUpload(fileName, `r${i}`)
    })
    await waitFor(() => expect(extractDeferreds.has(`r${i}`)).toBe(true))
    act(() => {
      resolveExtract(`r${i}`)
    })

    const inFlight = result.current.items.filter(
      (item) => item.status === 'uploading' || item.status === 'reading',
    )
    expect(inFlight.length).toBeLessThanOrEqual(2)
  }

  await waitFor(() => {
    expect(result.current.items.every((item) => item.status === 'done')).toBe(true)
  })
})

// --- Error handling ----------------------------------------------------

test('a 502 on one item fails just that item; the rest finish', async () => {
  const { result } = renderHook(() => useBatchUpload())
  await act(async () => {
    await result.current.addFiles([makeFile('a.jpg'), makeFile('b.jpg')])
  })
  act(() => {
    result.current.start(APARTMENT_ID)
  })

  await waitFor(() => expect(uploadDeferreds.size).toBe(2))
  act(() => {
    resolveUpload('a.jpg', 'ra')
    resolveUpload('b.jpg', 'rb')
  })

  await waitFor(() => expect(extractDeferreds.size).toBe(2))
  act(() => {
    extractDeferreds.get('ra')!.resolve(jsonResponse(502, { detail: 'Receipt extraction failed.' }))
    resolveExtract('rb')
  })

  await waitFor(() => {
    const a = result.current.items.find((i) => i.file.name === 'a.jpg')!
    const b = result.current.items.find((i) => i.file.name === 'b.jpg')!
    expect(a.status).toBe('failed')
    expect(b.status).toBe('done')
  })

  const a = result.current.items.find((i) => i.file.name === 'a.jpg')!
  expect(a.errorKind).toBe('unreadable')
  expect(a.error).toBe(EXTRACTION_FAILED_MESSAGE)
  expect(a.receiptId).toBe('ra')
  expect(result.current.pausedReason).toBeNull()
})

test('a 503 on one item pauses the queue; resume() continues the waiting items', async () => {
  const { result } = renderHook(() => useBatchUpload())
  await act(async () => {
    await result.current.addFiles([makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg')])
  })
  act(() => {
    result.current.start(APARTMENT_ID)
  })

  await waitFor(() => expect(uploadDeferreds.size).toBe(2))
  act(() => {
    resolveUpload('a.jpg', 'ra')
    resolveUpload('b.jpg', 'rb')
  })

  await waitFor(() => expect(extractDeferreds.size).toBe(2))
  act(() => {
    extractDeferreds.get('ra')!.resolve(jsonResponse(503, { detail: 'Not available' }))
  })

  await waitFor(() => {
    expect(result.current.items.find((i) => i.file.name === 'a.jpg')!.status).toBe('failed')
  })
  expect(result.current.pausedReason).toBe('unavailable')
  const a = result.current.items.find((i) => i.file.name === 'a.jpg')!
  expect(a.errorKind).toBe('unavailable')
  expect(a.error).toBe(EXTRACTION_NOT_CONFIGURED_MESSAGE)
  expect(result.current.items.find((i) => i.file.name === 'c.jpg')!.status).toBe('waiting')
  expect(uploadDeferreds.has('c.jpg')).toBe(false)

  // "b" (already in flight) finishes normally despite the pause
  act(() => {
    resolveExtract('rb')
  })
  await waitFor(() => {
    expect(result.current.items.find((i) => i.file.name === 'b.jpg')!.status).toBe('done')
  })
  expect(result.current.items.find((i) => i.file.name === 'c.jpg')!.status).toBe('waiting')

  act(() => {
    result.current.resume()
  })

  await waitFor(() => expect(uploadDeferreds.has('c.jpg')).toBe(true))
  act(() => {
    resolveUpload('c.jpg', 'rc')
  })
  await waitFor(() => expect(extractDeferreds.has('rc')).toBe(true))
  act(() => {
    resolveExtract('rc')
  })

  await waitFor(() => {
    expect(result.current.items.find((i) => i.file.name === 'c.jpg')!.status).toBe('done')
  })
  expect(result.current.pausedReason).toBeNull()
})

test('a network failure on upload pauses the queue; retry after resume works', async () => {
  const { result } = renderHook(() => useBatchUpload())
  await act(async () => {
    await result.current.addFiles([makeFile('a.jpg')])
  })
  act(() => {
    result.current.start(APARTMENT_ID)
  })

  await waitFor(() => expect(uploadDeferreds.has('a.jpg')).toBe(true))
  act(() => {
    uploadDeferreds.get('a.jpg')!.reject(new TypeError('Failed to fetch'))
  })

  await waitFor(() => {
    expect(result.current.items[0].status).toBe('failed')
  })
  expect(result.current.items[0].errorKind).toBe('network')
  expect(result.current.items[0].error).toBe(NETWORK_ERROR_MESSAGE)
  expect(result.current.pausedReason).toBe('network')

  act(() => {
    result.current.resume()
    result.current.retry(result.current.items[0].id)
  })

  await waitFor(() => expect(uploadDeferreds.has('a.jpg')).toBe(true))
  act(() => {
    resolveUpload('a.jpg', 'ra')
  })
  await waitFor(() => expect(extractDeferreds.has('ra')).toBe(true))
  act(() => {
    resolveExtract('ra')
  })

  await waitFor(() => {
    expect(result.current.items[0].status).toBe('done')
  })
})

// --- Retry ---------------------------------------------------------------

test('retrying an item with a receiptId calls extract only, never upload again', async () => {
  const { result } = renderHook(() => useBatchUpload())
  await act(async () => {
    await result.current.addFiles([makeFile('a.jpg')])
  })
  act(() => {
    result.current.start(APARTMENT_ID)
  })

  await waitFor(() => expect(uploadDeferreds.has('a.jpg')).toBe(true))
  act(() => {
    resolveUpload('a.jpg', 'ra')
  })
  await waitFor(() => expect(extractDeferreds.has('ra')).toBe(true))
  act(() => {
    extractDeferreds.get('ra')!.resolve(jsonResponse(502, { detail: 'boom' }))
  })

  await waitFor(() => {
    expect(result.current.items[0].status).toBe('failed')
  })
  expect(result.current.items[0].receiptId).toBe('ra')
  expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/receipts/upload'))).toHaveLength(1)

  act(() => {
    result.current.retry(result.current.items[0].id)
  })

  // A fresh deferred is created for the retried extract call
  await waitFor(() => {
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes('/extract'))).toHaveLength(2)
  })
  act(() => {
    resolveExtract('ra')
  })

  await waitFor(() => {
    expect(result.current.items[0].status).toBe('done')
  })
  // Upload was never called again -- only extract, reusing the existing receiptId
  expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/receipts/upload'))).toHaveLength(1)
})

test('retrying an item without a receiptId calls upload then extract', async () => {
  const { result } = renderHook(() => useBatchUpload())
  await act(async () => {
    await result.current.addFiles([makeFile('a.jpg')])
  })
  act(() => {
    result.current.start(APARTMENT_ID)
  })

  await waitFor(() => expect(uploadDeferreds.has('a.jpg')).toBe(true))
  act(() => {
    uploadDeferreds.get('a.jpg')!.resolve(jsonResponse(400, { detail: 'Unsupported file type.' }))
  })

  await waitFor(() => {
    expect(result.current.items[0].status).toBe('failed')
  })
  expect(result.current.items[0].receiptId).toBeUndefined()
  expect(result.current.items[0].errorKind).toBe('upload')
  expect(result.current.items[0].error).toBe('Unsupported file type.')

  act(() => {
    result.current.retry(result.current.items[0].id)
  })

  await waitFor(() => {
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/receipts/upload'))).toHaveLength(2)
  })
  act(() => {
    resolveUpload('a.jpg', 'ra')
  })
  await waitFor(() => expect(extractDeferreds.has('ra')).toBe(true))
  act(() => {
    resolveExtract('ra')
  })

  await waitFor(() => {
    expect(result.current.items[0].status).toBe('done')
  })
  expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes('/extract'))).toHaveLength(1)
})

test('a retried item goes back to the end of the processing order', async () => {
  const { result } = renderHook(() => useBatchUpload())
  await act(async () => {
    await result.current.addFiles([makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg')])
  })
  act(() => {
    result.current.start(APARTMENT_ID)
  })

  // "a" and "b" start first (CONCURRENCY=2); fail "a"
  await waitFor(() => expect(uploadDeferreds.size).toBe(2))
  act(() => {
    uploadDeferreds.get('a.jpg')!.resolve(jsonResponse(400, { detail: 'bad' }))
    resolveUpload('b.jpg', 'rb')
  })
  await waitFor(() => {
    expect(result.current.items.find((i) => i.file.name === 'a.jpg')!.status).toBe('failed')
  })
  await waitFor(() => expect(extractDeferreds.has('rb')).toBe(true))
  act(() => {
    resolveExtract('rb')
  })
  // "c" starts next (a slot freed up)
  await waitFor(() => expect(uploadDeferreds.has('c.jpg')).toBe(true))
  act(() => {
    resolveUpload('c.jpg', 'rc')
  })
  await waitFor(() => expect(extractDeferreds.has('rc')).toBe(true))
  act(() => {
    resolveExtract('rc')
  })
  await waitFor(() => {
    expect(result.current.items.every((i) => i.status === 'done' || i.status === 'failed')).toBe(true)
  })

  const failedId = result.current.items.find((i) => i.file.name === 'a.jpg')!.id
  act(() => {
    result.current.retry(failedId)
  })

  // The retried item moves to the end of the array
  expect(result.current.items[result.current.items.length - 1].id).toBe(failedId)

  await waitFor(() => expect(uploadDeferreds.has('a.jpg')).toBe(true))
  act(() => {
    resolveUpload('a.jpg', 'ra2')
  })
  await waitFor(() => expect(extractDeferreds.has('ra2')).toBe(true))
  act(() => {
    resolveExtract('ra2')
  })

  await waitFor(() => {
    expect(result.current.items.find((i) => i.id === failedId)!.status).toBe('done')
  })
})

// --- stop/resume ---------------------------------------------------------

test('stop() lets in-flight items finish and starts nothing new; resume() continues', async () => {
  const { result } = renderHook(() => useBatchUpload())
  await act(async () => {
    await result.current.addFiles([makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg')])
  })
  act(() => {
    result.current.start(APARTMENT_ID)
  })

  await waitFor(() => expect(uploadDeferreds.size).toBe(2))

  act(() => {
    result.current.stop()
  })
  expect(result.current.pausedReason).toBe('stopped')
  expect(result.current.items.find((i) => i.file.name === 'c.jpg')!.status).toBe('waiting')

  act(() => {
    resolveUpload('a.jpg', 'ra')
    resolveUpload('b.jpg', 'rb')
  })
  await waitFor(() => expect(extractDeferreds.size).toBe(2))
  act(() => {
    resolveExtract('ra')
    resolveExtract('rb')
  })
  await waitFor(() => {
    expect(result.current.items.find((i) => i.file.name === 'a.jpg')!.status).toBe('done')
    expect(result.current.items.find((i) => i.file.name === 'b.jpg')!.status).toBe('done')
  })
  expect(result.current.items.find((i) => i.file.name === 'c.jpg')!.status).toBe('waiting')
  expect(uploadDeferreds.has('c.jpg')).toBe(false)

  act(() => {
    result.current.resume()
  })

  await waitFor(() => expect(uploadDeferreds.has('c.jpg')).toBe(true))
  act(() => {
    resolveUpload('c.jpg', 'rc')
  })
  await waitFor(() => expect(extractDeferreds.has('rc')).toBe(true))
  act(() => {
    resolveExtract('rc')
  })
  await waitFor(() => {
    expect(result.current.items.find((i) => i.file.name === 'c.jpg')!.status).toBe('done')
  })
})

// --- Validation ----------------------------------------------------------

test('invalid file type and a bad PDF signature are rejected with the single-file messages', async () => {
  const { result } = renderHook(() => useBatchUpload())
  const invalid = makeFile('notes.txt', { type: 'text/plain' })
  const badPdf = makeFile('fake.pdf', { content: 'not a real pdf' })
  const good = makeFile('good.jpg')

  await act(async () => {
    await result.current.addFiles([invalid, badPdf, good])
  })

  expect(result.current.items).toHaveLength(1)
  expect(result.current.items[0].file.name).toBe('good.jpg')
  expect(result.current.rejected).toContainEqual({
    fileName: 'notes.txt',
    reason: 'Invalid file type. Please select a JPG, PNG, or PDF file.',
  })
  expect(result.current.rejected).toContainEqual({
    fileName: 'fake.pdf',
    reason: 'This file does not look like a valid PDF.',
  })
})

test('adding 25 valid files keeps only the first 20, with one rejected entry', async () => {
  const { result } = renderHook(() => useBatchUpload())
  const files = Array.from({ length: 25 }, (_, i) => makeFile(`receipt${i}.jpg`))

  await act(async () => {
    await result.current.addFiles(files)
  })

  expect(result.current.items).toHaveLength(MAX_BATCH)
  expect(result.current.items.map((i) => i.file.name)).toEqual(
    files.slice(0, MAX_BATCH).map((f) => f.name),
  )
  const overflowRejection = result.current.rejected.find((r) => r.reason.includes(`first ${MAX_BATCH}`))
  expect(overflowRejection).toBeDefined()
})

test('a file with the same name, size and lastModified as one already queued is skipped as a duplicate', async () => {
  const { result } = renderHook(() => useBatchUpload())
  const original = makeFile('a.jpg', { lastModified: 123, size: 10 })
  const duplicate = makeFile('a.jpg', { lastModified: 123, size: 10 })
  const different = makeFile('a.jpg', { lastModified: 456, size: 10 })

  await act(async () => {
    await result.current.addFiles([original])
  })
  // Duplicate-checking against "the queue" matters once the batch is
  // already running (appending more files mid-flight); start it first.
  act(() => {
    result.current.start(APARTMENT_ID)
  })
  await waitFor(() => expect(uploadDeferreds.has('a.jpg')).toBe(true))

  await act(async () => {
    await result.current.addFiles([duplicate, different])
  })

  expect(result.current.rejected).toContainEqual({ fileName: 'a.jpg', reason: 'duplicate' })
  // The file with a different lastModified is accepted (not treated as the same file)
  expect(result.current.items.filter((i) => i.file.name === 'a.jpg')).toHaveLength(2)
})

// --- Apartment id captured at start ---------------------------------------

test('the apartmentId captured at start() is used for every upload, including a retry', async () => {
  const { result } = renderHook(() => useBatchUpload())
  await act(async () => {
    await result.current.addFiles([makeFile('a.jpg')])
  })
  act(() => {
    result.current.start(APARTMENT_ID)
  })

  await waitFor(() => expect(uploadDeferreds.has('a.jpg')).toBe(true))
  act(() => {
    uploadDeferreds.get('a.jpg')!.resolve(jsonResponse(400, { detail: 'bad' }))
  })
  await waitFor(() => {
    expect(result.current.items[0].status).toBe('failed')
  })

  const firstUploadBody = fetchSpy.mock.calls.find(([url]) => String(url).endsWith('/receipts/upload'))![1]
    .body as FormData
  expect(firstUploadBody.get('apartment_id')).toBe(APARTMENT_ID)

  act(() => {
    result.current.retry(result.current.items[0].id)
  })
  await waitFor(() => {
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/receipts/upload'))).toHaveLength(2)
  })
  act(() => {
    resolveUpload('a.jpg', 'ra')
  })
  await waitFor(() => expect(extractDeferreds.has('ra')).toBe(true))
  act(() => {
    resolveExtract('ra')
  })
  await waitFor(() => {
    expect(result.current.items[0].status).toBe('done')
  })

  const retryUploadBody = fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/receipts/upload'))[1][1]
    .body as FormData
  expect(retryUploadBody.get('apartment_id')).toBe(APARTMENT_ID)
})

// --- remove / reset ----------------------------------------------------

test('remove() works on a waiting or failed item, and is ignored for an in-flight item', async () => {
  const { result } = renderHook(() => useBatchUpload())
  await act(async () => {
    await result.current.addFiles([makeFile('a.jpg'), makeFile('b.jpg')])
  })

  const waitingId = result.current.items[1].id
  act(() => {
    result.current.remove(waitingId)
  })
  expect(result.current.items).toHaveLength(1)

  act(() => {
    result.current.start(APARTMENT_ID)
  })
  const inFlightId = result.current.items[0].id
  await waitFor(() => {
    expect(result.current.items[0].status).toBe('uploading')
  })

  act(() => {
    result.current.remove(inFlightId)
  })
  expect(result.current.items).toHaveLength(1)
  expect(result.current.items[0].status).toBe('uploading')
})

test('reset() only clears the queue when nothing is in flight', async () => {
  const { result } = renderHook(() => useBatchUpload())
  await act(async () => {
    await result.current.addFiles([makeFile('a.jpg')])
  })
  act(() => {
    result.current.start(APARTMENT_ID)
  })
  await waitFor(() => {
    expect(result.current.items[0].status).toBe('uploading')
  })

  // reset() while in flight does nothing
  act(() => {
    result.current.reset()
  })
  expect(result.current.items).toHaveLength(1)

  await waitFor(() => expect(uploadDeferreds.has('a.jpg')).toBe(true))
  act(() => {
    resolveUpload('a.jpg', 'r1')
  })
  await waitFor(() => expect(extractDeferreds.has('r1')).toBe(true))
  act(() => {
    resolveExtract('r1')
  })
  await waitFor(() => {
    expect(result.current.items[0].status).toBe('done')
  })

  act(() => {
    result.current.reset()
  })
  expect(result.current.items).toHaveLength(0)
  expect(result.current.rejected).toHaveLength(0)
  expect(result.current.running).toBe(false)
  expect(result.current.pausedReason).toBeNull()
})

// --- Unmount safety --------------------------------------------------------

test('unmounting while a request is pending causes no console warning', async () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})

  const { result, unmount } = renderHook(() => useBatchUpload())
  await act(async () => {
    await result.current.addFiles([makeFile('a.jpg')])
  })
  act(() => {
    result.current.start(APARTMENT_ID)
  })
  await waitFor(() => expect(uploadDeferreds.has('a.jpg')).toBe(true))

  unmount()

  await act(async () => {
    resolveUpload('a.jpg', 'r1')
    await Promise.resolve()
    await Promise.resolve()
  })

  expect(consoleError).not.toHaveBeenCalled()
  consoleError.mockRestore()
})

// --- warningsCount -------------------------------------------------------

test('warningsCount is taken from the extract response', async () => {
  const { result } = renderHook(() => useBatchUpload())
  await act(async () => {
    await result.current.addFiles([makeFile('a.jpg')])
  })
  act(() => {
    result.current.start(APARTMENT_ID)
  })

  await waitFor(() => expect(uploadDeferreds.has('a.jpg')).toBe(true))
  act(() => {
    resolveUpload('a.jpg', 'r1')
  })
  await waitFor(() => expect(extractDeferreds.has('r1')).toBe(true))
  act(() => {
    resolveExtract('r1', {
      warnings: [
        { code: 'MISSING_STORE', field: 'store_name', message: 'x', details: {} },
        { code: 'MISSING_TOTAL', field: 'total', message: 'y', details: {} },
      ],
    })
  })

  await waitFor(() => {
    expect(result.current.items[0].status).toBe('done')
  })
  expect(result.current.items[0].warningsCount).toBe(2)
})

// --- What was read (extracted summary) -----------------------------------

test('a done item keeps store_name, purchase_date, total and currency from the extract response', async () => {
  // Given one started item
  const { result } = renderHook(() => useBatchUpload())
  await act(async () => {
    await result.current.addFiles([makeFile('a.jpg')])
  })
  act(() => {
    result.current.start(APARTMENT_ID)
  })
  await waitFor(() => expect(uploadDeferreds.has('a.jpg')).toBe(true))
  act(() => {
    resolveUpload('a.jpg', 'r1')
  })
  await waitFor(() => expect(extractDeferreds.has('r1')).toBe(true))

  // When the extract answers
  act(() => {
    resolveExtract('r1', { store_name: 'Edeka', purchase_date: '2026-11-20', total: 23.5, currency: 'EUR' })
  })

  // Then the item carries exactly those four values
  await waitFor(() => expect(result.current.items[0].status).toBe('done'))
  expect(result.current.items[0].extracted).toEqual({
    store_name: 'Edeka',
    purchase_date: '2026-11-20',
    total: 23.5,
    currency: 'EUR',
  })
})

test('missing values in the extract response are kept as null (never guessed)', async () => {
  // Given one started item
  const { result } = renderHook(() => useBatchUpload())
  await act(async () => {
    await result.current.addFiles([makeFile('a.jpg')])
  })
  act(() => {
    result.current.start(APARTMENT_ID)
  })
  await waitFor(() => expect(uploadDeferreds.has('a.jpg')).toBe(true))
  act(() => {
    resolveUpload('a.jpg', 'r1')
  })
  await waitFor(() => expect(extractDeferreds.has('r1')).toBe(true))

  // When the AI could read none of them
  act(() => {
    resolveExtract('r1', { store_name: null, purchase_date: null, total: null, currency: null })
  })

  // Then all four are null
  await waitFor(() => expect(result.current.items[0].status).toBe('done'))
  expect(result.current.items[0].extracted).toEqual({
    store_name: null,
    purchase_date: null,
    total: null,
    currency: null,
  })
})

test('a failed or skipped item never gets an extracted summary', async () => {
  // Given two started items, no client-side pre-check
  const { result } = renderHook(() =>
    useBatchUpload({ hasher: jest.fn().mockResolvedValue(null), checkDuplicates: jest.fn() }),
  )
  await act(async () => {
    await result.current.addFiles([makeFile('a.jpg'), makeFile('b.jpg')])
  })
  act(() => result.current.start(APARTMENT_ID))
  await waitFor(() => expect(uploadDeferreds.has('b.jpg')).toBe(true))

  // When a's upload is a server-side duplicate and b's extract returns 502
  act(() => {
    uploadDeferreds.get('a.jpg')!.resolve(
      jsonResponse(409, { detail: { code: 'DUPLICATE_FILE', message: 'This file is already saved.', existing: null } }),
    )
    resolveUpload('b.jpg', 'r-b')
  })
  await waitFor(() => expect(extractDeferreds.has('r-b')).toBe(true))
  act(() => {
    extractDeferreds.get('r-b')!.resolve(jsonResponse(502, { detail: 'boom' }))
  })

  // Then neither carries an extracted summary
  await waitFor(() => {
    expect(result.current.items.find((i) => i.file.name === 'a.jpg')!.status).toBe('skipped')
    expect(result.current.items.find((i) => i.file.name === 'b.jpg')!.status).toBe('failed')
  })
  for (const item of result.current.items) {
    expect(item.extracted).toBeUndefined()
  }
})

// --- Duplicate detection (injected hasher/checkDuplicates fakes) -----------

function makeExisting(receiptId: string, overrides: Partial<ReceiptSummary> = {}): ReceiptSummary {
  return {
    receipt_id: receiptId,
    original_filename: 'receipt.jpg',
    store_name: 'Corner Store',
    purchase_date: '2026-01-15',
    currency: 'EUR',
    total: 19.99,
    created_at: '2026-01-15T10:00:00+00:00',
    apartment_id: APARTMENT_ID,
    apartment_name: 'Bergblick',
    status: 'needs_review',
    ...overrides,
  }
}

/** A hasher that returns a fixed hash per file name (so two files can be
 * made to "collide" just by giving them the same name->hash mapping). */
function fakeHasherFromMap(hashesByName: Record<string, string | null>) {
  return async (file: File) => hashesByName[file.name] ?? null
}

describe('duplicate detection', () => {
  test('one hash already saved on the server -> that item is skipped "duplicate", the rest stay waiting', async () => {
    const existing = makeExisting('existing-1')
    const hasher = fakeHasherFromMap({ 'a.jpg': 'hash-a', 'b.jpg': 'hash-b', 'c.jpg': 'hash-c' })
    const checkDuplicates = jest.fn().mockResolvedValue({
      items: [
        { hash: 'hash-a', existing: null },
        { hash: 'hash-b', existing },
        { hash: 'hash-c', existing: null },
      ],
    })

    const { result } = renderHook(() => useBatchUpload({ hasher, checkDuplicates }))
    await act(async () => {
      await result.current.addFiles([makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg')])
    })

    expect(checkDuplicates).toHaveBeenCalledTimes(1)
    expect(checkDuplicates).toHaveBeenCalledWith(['hash-a', 'hash-b', 'hash-c'])

    const byName = Object.fromEntries(result.current.items.map((item) => [item.file.name, item]))
    expect(byName['a.jpg'].status).toBe('waiting')
    expect(byName['c.jpg'].status).toBe('waiting')
    expect(byName['b.jpg'].status).toBe('skipped')
    expect(byName['b.jpg'].errorKind).toBe('duplicate')
    expect(byName['b.jpg'].existing).toEqual(existing)

    const nonSkipped = result.current.items.filter((item) => item.status !== 'skipped')
    expect(nonSkipped).toHaveLength(2)
  })

  test('two files with the same hash in one batch: the second is skipped "duplicate_in_batch", no server match needed for it', async () => {
    const hasher = fakeHasherFromMap({ 'a.jpg': 'same-hash', 'b.jpg': 'same-hash' })
    const checkDuplicates = jest.fn().mockResolvedValue({ items: [{ hash: 'same-hash', existing: null }] })

    const { result } = renderHook(() => useBatchUpload({ hasher, checkDuplicates }))
    await act(async () => {
      await result.current.addFiles([makeFile('a.jpg'), makeFile('b.jpg')])
    })

    // Only the first occurrence of the hash is ever sent to the server.
    expect(checkDuplicates).toHaveBeenCalledTimes(1)
    expect(checkDuplicates).toHaveBeenCalledWith(['same-hash'])

    const byName = Object.fromEntries(result.current.items.map((item) => [item.file.name, item]))
    expect(byName['a.jpg'].status).toBe('waiting')
    expect(byName['b.jpg'].status).toBe('skipped')
    expect(byName['b.jpg'].errorKind).toBe('duplicate_in_batch')
    expect(byName['b.jpg'].existing).toBeNull()
  })

  test('a file matching an earlier, already-queued item (from a previous addFiles call) is also "duplicate_in_batch"', async () => {
    const hasher = fakeHasherFromMap({ 'a.jpg': 'hash-1', 'b.jpg': 'hash-1' })
    const checkDuplicates = jest.fn().mockResolvedValue({ items: [{ hash: 'hash-1', existing: null }] })

    const { result } = renderHook(() => useBatchUpload({ hasher, checkDuplicates }))
    await act(async () => {
      await result.current.addFiles([makeFile('a.jpg')])
    })
    // Appending a second file while the batch is already running (rather
    // than picking files again before starting, which replaces the queue)
    // is the only way a second addFiles call keeps the first file around.
    act(() => {
      result.current.start(APARTMENT_ID)
    })
    await act(async () => {
      await result.current.addFiles([makeFile('b.jpg')])
    })

    // "a.jpg" is still present (started uploading once the batch began
    // running) -- never replaced by the second addFiles call, which
    // appends while running instead of replacing the queue.
    const byName = Object.fromEntries(result.current.items.map((item) => [item.file.name, item]))
    expect(byName['a.jpg']).toBeDefined()
    expect(byName['a.jpg'].status).not.toBe('skipped')
    expect(byName['b.jpg'].status).toBe('skipped')
    expect(byName['b.jpg'].errorKind).toBe('duplicate_in_batch')

    // Cleanup: let the in-flight upload resolve so no dangling promise leaks.
    await waitFor(() => expect(uploadDeferreds.has('a.jpg')).toBe(true))
    act(() => resolveUpload('a.jpg', 'r-a'))
    await waitFor(() => expect(extractDeferreds.has('r-a')).toBe(true))
    act(() => resolveExtract('r-a'))
    await waitFor(() => expect(result.current.items.find((i) => i.file.name === 'a.jpg')!.status).toBe('done'))
  })

  test('the check request carries every hash in exactly one call, never one call per file', async () => {
    const hasher = fakeHasherFromMap({ 'a.jpg': 'h1', 'b.jpg': 'h2', 'c.jpg': 'h3' })
    const checkDuplicates = jest.fn().mockResolvedValue({
      items: [
        { hash: 'h1', existing: null },
        { hash: 'h2', existing: null },
        { hash: 'h3', existing: null },
      ],
    })

    const { result } = renderHook(() => useBatchUpload({ hasher, checkDuplicates }))
    await act(async () => {
      await result.current.addFiles([makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg')])
    })

    expect(checkDuplicates).toHaveBeenCalledTimes(1)
  })

  test('no request is made when the hasher returns null for every file', async () => {
    const hasher = jest.fn().mockResolvedValue(null)
    const checkDuplicates = jest.fn()

    const { result } = renderHook(() => useBatchUpload({ hasher, checkDuplicates }))
    await act(async () => {
      await result.current.addFiles([makeFile('a.jpg'), makeFile('b.jpg')])
    })

    expect(checkDuplicates).not.toHaveBeenCalled()
    expect(result.current.duplicateCheckFailed).toBe(false)
    expect(result.current.items.every((item) => item.status === 'waiting')).toBe(true)
  })

  test('no request is made when there are no valid files to add', async () => {
    const hasher = jest.fn()
    const checkDuplicates = jest.fn()

    const { result } = renderHook(() => useBatchUpload({ hasher, checkDuplicates }))
    await act(async () => {
      await result.current.addFiles([new File(['x'], 'notes.txt', { type: 'text/plain' })])
    })

    expect(hasher).not.toHaveBeenCalled()
    expect(checkDuplicates).not.toHaveBeenCalled()
    expect(result.current.items).toHaveLength(0)
  })

  test('a failed check-duplicates request sets duplicateCheckFailed and leaves items waiting -- the queue still works', async () => {
    const hasher = fakeHasherFromMap({ 'a.jpg': 'hash-a' })
    const checkDuplicates = jest.fn().mockRejectedValue(new Error('network down'))

    const { result } = renderHook(() => useBatchUpload({ hasher, checkDuplicates }))
    await act(async () => {
      await result.current.addFiles([makeFile('a.jpg')])
    })

    expect(result.current.duplicateCheckFailed).toBe(true)
    expect(result.current.checkingDuplicates).toBe(false)
    expect(result.current.items[0].status).toBe('waiting')

    // And the queue still runs normally afterwards.
    act(() => {
      result.current.start(APARTMENT_ID)
    })
    await waitFor(() => expect(uploadDeferreds.has('a.jpg')).toBe(true))
    act(() => resolveUpload('a.jpg', 'r1'))
    await waitFor(() => expect(extractDeferreds.has('r1')).toBe(true))
    act(() => resolveExtract('r1'))
    await waitFor(() => expect(result.current.items[0].status).toBe('done'))
  })

  test('checkingDuplicates is true while the check is in flight and false once it settles', async () => {
    let resolveCheck!: (value: unknown) => void
    const checkPromise = new Promise((resolve) => {
      resolveCheck = resolve
    })
    const hasher = fakeHasherFromMap({ 'a.jpg': 'hash-a' })
    const checkDuplicates = jest.fn().mockReturnValue(checkPromise)

    const { result } = renderHook(() => useBatchUpload({ hasher, checkDuplicates }))
    let addFilesPromise!: Promise<void>
    act(() => {
      addFilesPromise = result.current.addFiles([makeFile('a.jpg')])
    })

    await waitFor(() => expect(result.current.checkingDuplicates).toBe(true))

    await act(async () => {
      resolveCheck({ items: [{ hash: 'hash-a', existing: null }] })
      await addFilesPromise
    })

    expect(result.current.checkingDuplicates).toBe(false)
  })

  test('skipped items are never uploaded when the batch runs', async () => {
    const existing = makeExisting('existing-1')
    const hasher = fakeHasherFromMap({ 'a.jpg': 'hash-a', 'b.jpg': 'hash-b' })
    const checkDuplicates = jest.fn().mockResolvedValue({
      items: [
        { hash: 'hash-a', existing },
        { hash: 'hash-b', existing: null },
      ],
    })

    const { result } = renderHook(() => useBatchUpload({ hasher, checkDuplicates }))
    await act(async () => {
      await result.current.addFiles([makeFile('a.jpg'), makeFile('b.jpg')])
    })

    act(() => {
      result.current.start(APARTMENT_ID)
    })

    // Only "b.jpg" (not skipped) is ever uploaded.
    await waitFor(() => expect(uploadDeferreds.has('b.jpg')).toBe(true))
    expect(uploadDeferreds.has('a.jpg')).toBe(false)

    act(() => resolveUpload('b.jpg', 'r-b'))
    await waitFor(() => expect(extractDeferreds.has('r-b')).toBe(true))
    act(() => resolveExtract('r-b'))

    await waitFor(() => {
      const a = result.current.items.find((item) => item.file.name === 'a.jpg')!
      const b = result.current.items.find((item) => item.file.name === 'b.jpg')!
      expect(a.status).toBe('skipped')
      expect(b.status).toBe('done')
    })
    expect(uploadDeferreds.has('a.jpg')).toBe(false)
  })

  test('"Upload anyway" re-queues a skipped item with allowDuplicate, sending allow_duplicate=true', async () => {
    const existing = makeExisting('existing-1')
    const hasher = fakeHasherFromMap({ 'a.jpg': 'hash-a' })
    const checkDuplicates = jest.fn().mockResolvedValue({ items: [{ hash: 'hash-a', existing }] })

    const { result } = renderHook(() => useBatchUpload({ hasher, checkDuplicates }))
    await act(async () => {
      await result.current.addFiles([makeFile('a.jpg')])
    })
    expect(result.current.items[0].status).toBe('skipped')

    act(() => {
      result.current.uploadAnyway(result.current.items[0].id)
    })
    expect(result.current.items[0].status).toBe('waiting')
    expect(result.current.items[0].allowDuplicate).toBe(true)

    act(() => {
      result.current.start(APARTMENT_ID)
    })

    await waitFor(() => expect(uploadDeferreds.has('a.jpg')).toBe(true))
    const [, options] = fetchSpy.mock.calls.find(([url]) => String(url).endsWith('/receipts/upload'))!
    expect(((options as RequestInit).body as FormData).get('allow_duplicate')).toBe('true')

    act(() => resolveUpload('a.jpg', 'r1'))
    await waitFor(() => expect(extractDeferreds.has('r1')).toBe(true))
    act(() => resolveExtract('r1'))
    await waitFor(() => expect(result.current.items[0].status).toBe('done'))
  })

  test('allowDuplicate survives a later retry', async () => {
    const existing = makeExisting('existing-1')
    const hasher = fakeHasherFromMap({ 'a.jpg': 'hash-a' })
    const checkDuplicates = jest.fn().mockResolvedValue({ items: [{ hash: 'hash-a', existing }] })

    const { result } = renderHook(() => useBatchUpload({ hasher, checkDuplicates }))
    await act(async () => {
      await result.current.addFiles([makeFile('a.jpg')])
    })
    act(() => result.current.uploadAnyway(result.current.items[0].id))
    act(() => result.current.start(APARTMENT_ID))

    await waitFor(() => expect(uploadDeferreds.has('a.jpg')).toBe(true))
    act(() => {
      uploadDeferreds.get('a.jpg')!.resolve(jsonResponse(502, { detail: 'Upload failed.' }))
    })
    await waitFor(() => expect(result.current.items[0].status).toBe('failed'))

    act(() => {
      result.current.retry(result.current.items[0].id)
    })
    expect(result.current.items[0].allowDuplicate).toBe(true)
  })

  test('a 409 DUPLICATE_FILE during upload skips the item without pausing; the other item still finishes', async () => {
    const existing = makeExisting('existing-1')
    const hasher = jest.fn().mockResolvedValue(null) // no pre-check, so this is purely the server's own 409
    const checkDuplicates = jest.fn()

    const { result } = renderHook(() => useBatchUpload({ hasher, checkDuplicates }))
    await act(async () => {
      await result.current.addFiles([makeFile('a.jpg'), makeFile('b.jpg')])
    })
    act(() => result.current.start(APARTMENT_ID))

    await waitFor(() => expect(uploadDeferreds.has('a.jpg')).toBe(true))
    await waitFor(() => expect(uploadDeferreds.has('b.jpg')).toBe(true))

    act(() => {
      uploadDeferreds.get('a.jpg')!.resolve(
        jsonResponse(409, {
          detail: { code: 'DUPLICATE_FILE', message: 'This file is already saved.', existing },
        }),
      )
    })
    await waitFor(() => {
      const a = result.current.items.find((item) => item.file.name === 'a.jpg')!
      expect(a.status).toBe('skipped')
      expect(a.errorKind).toBe('duplicate')
      expect(a.existing).toEqual(existing)
    })
    expect(result.current.pausedReason).toBeNull()

    act(() => resolveUpload('b.jpg', 'r-b'))
    await waitFor(() => expect(extractDeferreds.has('r-b')).toBe(true))
    act(() => resolveExtract('r-b'))
    await waitFor(() => {
      expect(result.current.items.find((item) => item.file.name === 'b.jpg')!.status).toBe('done')
    })
  })

  test('skipped items can be removed, same as waiting/failed', async () => {
    const existing = makeExisting('existing-1')
    const hasher = fakeHasherFromMap({ 'a.jpg': 'hash-a' })
    const checkDuplicates = jest.fn().mockResolvedValue({ items: [{ hash: 'hash-a', existing }] })

    const { result } = renderHook(() => useBatchUpload({ hasher, checkDuplicates }))
    await act(async () => {
      await result.current.addFiles([makeFile('a.jpg')])
    })
    expect(result.current.items[0].status).toBe('skipped')

    act(() => {
      result.current.remove(result.current.items[0].id)
    })
    expect(result.current.items).toHaveLength(0)
  })
})
