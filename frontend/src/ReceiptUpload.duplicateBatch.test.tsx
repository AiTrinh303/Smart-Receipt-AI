import { webcrypto } from 'node:crypto'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReceiptUpload from './ReceiptUpload'
import { mockObjectUrl } from './test/objectUrl'
import { SAMPLE_APARTMENTS, jsonResponse, withApartments } from './test/apartmentsFetch'

// Real sha256Hex is used throughout this file (not an injected fake, since
// ReceiptUpload.tsx itself wires useBatchUpload() with no overrides) -- so
// crypto.subtle is polyfilled with Node's own WebCrypto, the same approach
// src/hash/sha256.test.ts uses, scoped to this file only.
let hadSubtle: boolean
beforeAll(() => {
  hadSubtle = 'subtle' in globalThis.crypto
  if (!hadSubtle) {
    Object.defineProperty(globalThis.crypto, 'subtle', { value: webcrypto.subtle, configurable: true })
  }
})
afterAll(() => {
  if (!hadSubtle) {
    // @ts-expect-error removing the test-only polyfill
    delete globalThis.crypto.subtle
  }
})

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

function makeFile(name: string, content = name): File {
  return new File([content], name, { type: 'image/jpeg' })
}

const EXISTING_RECEIPT = {
  receipt_id: 'existing-receipt-id',
  original_filename: 'b.jpg',
  store_name: 'Corner Store',
  purchase_date: '2026-01-15',
  currency: 'EUR',
  total: 19.99,
  created_at: '2026-01-15T10:00:00+00:00',
  apartment_id: SAMPLE_APARTMENTS[0].id,
  apartment_name: SAMPLE_APARTMENTS[0].name,
  status: 'needs_review',
}

let fetchSpy: jest.Mock
let checkDuplicatesImpl: ((hashes: string[]) => Promise<unknown>) | null

beforeEach(() => {
  checkDuplicatesImpl = null
  fetchSpy = jest.fn().mockImplementation(
    withApartments((urlString: string, options?: RequestInit) => {
      if (urlString.endsWith('/receipts/check-duplicates')) {
        const { hashes } = JSON.parse((options!.body as string) ?? '{}') as { hashes: string[] }
        if (checkDuplicatesImpl) {
          return checkDuplicatesImpl(hashes)
        }
        return Promise.resolve(jsonResponse(200, { items: hashes.map((hash) => ({ hash, existing: null })) }))
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

async function addFilesAndChooseApartment(files: File[]) {
  const user = userEvent.setup()
  render(<ReceiptUpload />)
  const input = screen.getByLabelText(/upload receipt/i)
  await user.upload(input, files)
  await user.click(await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name }))
  return user
}

test('one file matching a saved receipt shows one skipped row and "Read N receipts" counts only the rest', async () => {
  checkDuplicatesImpl = (hashes) =>
    Promise.resolve(
      jsonResponse(200, {
        items: hashes.map((hash, index) => ({
          hash,
          existing: index === 1 ? EXISTING_RECEIPT : null,
        })),
      }),
    )

  await addFilesAndChooseApartment([makeFile('a.jpg', 'content-a'), makeFile('b.jpg', 'content-b'), makeFile('c.jpg', 'content-c')])

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Read 2 receipts' })).toBeInTheDocument()
  })
  expect(screen.getByText('Already saved')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Open saved receipt' })).toHaveAttribute(
    'href',
    `/?receipt=${EXISTING_RECEIPT.receipt_id}`,
  )
})

test('"Checking for duplicates..." shows while the check is in flight, and the start button is disabled', async () => {
  let resolveCheck!: (value: unknown) => void
  checkDuplicatesImpl = () =>
    new Promise((resolve) => {
      resolveCheck = resolve
    })

  await addFilesAndChooseApartment([makeFile('a.jpg', 'content-a'), makeFile('b.jpg', 'content-b')])

  await waitFor(() => {
    expect(screen.getByRole('status', { name: '' })).toBeInTheDocument()
  })
  expect(screen.getByText('Checking for duplicates...')).toBeInTheDocument()
  const startButton = screen.getByRole('button', { name: /read \d+ receipts/i })
  expect(startButton).toBeDisabled()

  resolveCheck(jsonResponse(200, { items: [] }))
  await waitFor(() => {
    expect(screen.queryByText('Checking for duplicates...')).not.toBeInTheDocument()
  })
})

test('a failed check-duplicates request shows the muted note and the queue still works', async () => {
  checkDuplicatesImpl = () => Promise.reject(new Error('network down'))

  // At least 2 files, so this goes through the batch flow (1 file alone
  // stays in the single-file flow, which never pre-checks at all).
  await addFilesAndChooseApartment([makeFile('a.jpg', 'content-a'), makeFile('b.jpg', 'content-b')])

  await waitFor(() => {
    expect(screen.getByText('Could not check for duplicates before uploading.')).toBeInTheDocument()
  })
  // Both files are still there, ready to upload normally.
  expect(screen.getByRole('button', { name: 'Read 2 receipts' })).toBeInTheDocument()
})

test('all files already saved: "All files are already saved." shown, start button disabled', async () => {
  checkDuplicatesImpl = (hashes) =>
    Promise.resolve(jsonResponse(200, { items: hashes.map((hash) => ({ hash, existing: EXISTING_RECEIPT })) }))

  await addFilesAndChooseApartment([makeFile('a.jpg', 'content-a'), makeFile('b.jpg', 'content-b')])

  await waitFor(() => {
    expect(screen.getByText('All files are already saved.')).toBeInTheDocument()
  })
  expect(screen.getByRole('button', { name: 'Read 0 receipts' })).toBeDisabled()
  expect(screen.queryByText(/each receipt is sent to openai/i)).not.toBeInTheDocument()
})
