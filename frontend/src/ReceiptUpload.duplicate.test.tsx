import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReceiptUpload from './ReceiptUpload'
import { mockObjectUrl } from './test/objectUrl'
import { SAMPLE_APARTMENTS, jsonResponse, withApartments } from './test/apartmentsFetch'

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

let fetchSpy: jest.Mock
beforeEach(() => {
  fetchSpy = jest.fn().mockImplementation(withApartments(() => Promise.reject(new Error('Unexpected fetch call'))))
  global.fetch = fetchSpy as unknown as typeof fetch
})
afterEach(() => {
  // @ts-expect-error cleaning up the test-only global fetch stub
  delete global.fetch
})

function getFileInput() {
  return screen.getByLabelText(/upload receipt/i)
}

function getSubmitButton() {
  return screen.getByRole('button', { name: /read receipt|uploading|extracting/i })
}

async function chooseApartment(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name }))
}

async function selectValidFile() {
  const user = userEvent.setup()
  render(<ReceiptUpload />)
  const validFile = new File(['dummy'], 'receipt.jpg', { type: 'image/jpeg' })
  await user.upload(getFileInput(), validFile)
  await chooseApartment(user)
  return { user, validFile }
}

const EXISTING_RECEIPT = {
  receipt_id: 'existing-receipt-id',
  original_filename: 'receipt.jpg',
  store_name: 'Corner Store',
  purchase_date: '2026-01-15',
  currency: 'EUR',
  total: 19.99,
  created_at: '2026-01-15T10:00:00+00:00',
  apartment_id: SAMPLE_APARTMENTS[0].id,
  apartment_name: SAMPLE_APARTMENTS[0].name,
  status: 'needs_review',
}

function duplicateFileResponse() {
  return jsonResponse(409, {
    detail: {
      code: 'DUPLICATE_FILE',
      message: 'This file is already saved.',
      existing: EXISTING_RECEIPT,
    },
  })
}

/** Routes upload/extract independently, same pattern as ReceiptUpload.test.tsx. */
function routeFetch(routes: { upload?: () => Promise<unknown>; extract?: () => Promise<unknown> }) {
  fetchSpy.mockImplementation(
    withApartments((urlString: string) => {
      if (urlString.endsWith('/receipts/upload')) {
        return routes.upload ? routes.upload() : Promise.reject(new Error(`Unexpected upload call to ${urlString}`))
      }
      if (urlString.includes('/extract')) {
        return routes.extract
          ? routes.extract()
          : Promise.reject(new Error(`Unexpected extract call to ${urlString}`))
      }
      return Promise.reject(new Error(`Unexpected fetch call to ${urlString}`))
    }),
  )
}

test('a 409 DUPLICATE_FILE shows the warning Alert instead of the generic error, with no extraction call', async () => {
  // Given the upload answers 409 DUPLICATE_FILE
  routeFetch({ upload: () => Promise.resolve(duplicateFileResponse()) })
  const { user } = await selectValidFile()

  // When the user submits
  await user.click(getSubmitButton())

  // Then the warning Alert names the existing receipt, not the generic error
  // (the sentence is built from several interpolated parts, so matched via
  // the paragraph's full normalized text content rather than one exact
  // string match).
  await waitFor(() => {
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName.toLowerCase() === 'p' &&
          element.textContent ===
            'This file is already saved as Corner Store, 15.01.2026, EUR 19.99 (Oberaudorf Bergblick).',
      ),
    ).toBeInTheDocument()
  })
  expect(screen.queryByText('This file is already saved.')).not.toBeInTheDocument()

  // And an "Open saved receipt" link and "Upload anyway" button are offered
  const link = screen.getByRole('link', { name: 'Open saved receipt' })
  expect(link).toHaveAttribute('href', `/?receipt=${EXISTING_RECEIPT.receipt_id}`)
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  expect(screen.getByRole('button', { name: 'Upload anyway' })).toBeInTheDocument()

  // And nothing was ever extracted
  expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/extract'))).toBe(false)
})

test('"Upload anyway" repeats the upload with allow_duplicate=true, then extracts normally on success', async () => {
  // Given the first upload attempt is a duplicate
  let uploadCallCount = 0
  routeFetch({
    upload: () => {
      uploadCallCount += 1
      if (uploadCallCount === 1) {
        return Promise.resolve(duplicateFileResponse())
      }
      return Promise.resolve(jsonResponse(201, { receipt_id: 'new-receipt-id', filename: 'receipt.jpg' }))
    },
    extract: () =>
      Promise.resolve(
        jsonResponse(200, {
          receipt_id: 'new-receipt-id',
          store_name: 'Corner Store',
          purchase_date: '2026-01-15',
          currency: 'EUR',
          items: [],
          discounts: [],
          taxes: [],
          total: 19.99,
          warnings: [],
          edited: false,
          edited_at: null,
          apartment_id: null,
          apartment_name: null,
          status: 'needs_review',
        }),
      ),
  })
  const { user } = await selectValidFile()
  await user.click(getSubmitButton())
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Upload anyway' })).toBeInTheDocument()
  })

  // When "Upload anyway" is clicked
  await user.click(screen.getByRole('button', { name: 'Upload anyway' }))

  // Then a second upload call is made with allow_duplicate=true
  await waitFor(() => expect(uploadCallCount).toBe(2))
  const secondCallBody = fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/receipts/upload'))[1][1]
    .body as FormData
  expect(secondCallBody.get('allow_duplicate')).toBe('true')

  // And extraction proceeds normally (the duplicate Alert is gone, replaced
  // by the extracted result)
  await waitFor(() => {
    expect(screen.getByText('Corner Store')).toBeInTheDocument()
  })
  expect(
    screen.queryByText(
      (_, element) =>
        element?.tagName.toLowerCase() === 'p' &&
        element.textContent === 'This file is already saved as Corner Store, 15.01.2026, EUR 19.99 (Oberaudorf Bergblick).',
    ),
  ).not.toBeInTheDocument()
})

test('no pre-check request is made in the single-file flow -- only /apartments, /receipts/upload and /extract are ever called', async () => {
  routeFetch({
    upload: () => Promise.resolve(jsonResponse(201, { receipt_id: 'id', filename: 'receipt.jpg' })),
    extract: () =>
      Promise.resolve(
        jsonResponse(200, {
          receipt_id: 'id',
          store_name: null,
          purchase_date: null,
          currency: null,
          items: [],
          discounts: [],
          taxes: [],
          total: null,
          warnings: [],
          edited: false,
          edited_at: null,
          apartment_id: null,
          apartment_name: null,
          status: 'needs_review',
        }),
      ),
  })
  const { user } = await selectValidFile()
  await user.click(getSubmitButton())

  await waitFor(() => expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/extract'))).toBe(true))
  for (const [url] of fetchSpy.mock.calls) {
    const urlString = String(url)
    expect(urlString.endsWith('/check-duplicates')).toBe(false)
  }
})
