import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReceiptUpload from './ReceiptUpload'
import { mockObjectUrl } from './test/objectUrl'
import { SAMPLE_APARTMENTS, clearApartmentsCache, jsonResponse, withApartments } from './test/apartmentsFetch'

beforeEach(() => {
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

// jsdom has neither URL.createObjectURL nor URL.revokeObjectURL; selecting a
// JPG/PNG creates a preview object URL.
let objectUrl: ReturnType<typeof mockObjectUrl>
beforeEach(() => {
  objectUrl = mockObjectUrl()
})
afterEach(() => {
  objectUrl.restore()
})

// Different tests in this file mock different /apartments responses
// (success, failure); the hook only caches a SUCCESSFUL result, but that
// cache is still shared across tests in this file, so clear it between
// every test to keep each one's mocked response in effect.
beforeEach(() => {
  clearApartmentsCache()
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

function routeUploadAndExtract(receiptId = 'abc-123') {
  fetchSpy.mockImplementation(
    withApartments((urlString) => {
      if (urlString.endsWith('/receipts/upload')) {
        return Promise.resolve(jsonResponse(201, { receipt_id: receiptId, filename: 'receipt.jpg' }))
      }
      if (urlString.includes('/extract')) {
        return Promise.resolve(
          jsonResponse(200, {
            receipt_id: receiptId,
            store_name: 'Corner Store',
            items: [],
            discounts: [],
            taxes: [],
            warnings: [],
            edited: false,
            edited_at: null,
          }),
        )
      }
      return Promise.reject(new Error(`Unexpected fetch call to ${urlString}`))
    }),
  )
}

async function selectValidFile(user: ReturnType<typeof userEvent.setup>) {
  const validFile = new File(['dummy'], 'receipt.jpg', { type: 'image/jpeg' })
  await user.upload(getFileInput(), validFile)
  return validFile
}

test('loads and shows both mocked apartments as radio options, none checked', async () => {
  // Given the upload form is rendered and the apartment list loads successfully
  render(<ReceiptUpload />)

  // Then both mocked apartments appear as radio options, and neither is preselected
  const first = await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })
  const second = screen.getByRole('radio', { name: SAMPLE_APARTMENTS[1].name })
  expect(first).not.toBeChecked()
  expect(second).not.toBeChecked()
})

test('while apartments are loading, "Loading apartments..." is shown', () => {
  // Given the apartments request has not resolved yet
  fetchSpy.mockImplementation(
    withApartments(
      (urlString) => Promise.reject(new Error(`Unexpected fetch call to ${urlString}`)),
      () => new Promise(() => {}),
    ),
  )

  // When the upload form is rendered
  render(<ReceiptUpload />)

  // Then a loading message is shown
  expect(screen.getByText('Loading apartments...')).toBeInTheDocument()
})

test('a valid file alone leaves Submit disabled and shows the muted helper text', async () => {
  // Given the upload form is rendered and apartments have loaded
  const user = userEvent.setup()
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })

  // When the user selects a valid file but chooses no apartment
  await selectValidFile(user)

  // Then Submit stays disabled and the muted helper is shown, described by the fieldset
  expect(getSubmitButton()).toBeDisabled()
  const helper = screen.getByText('Choose an apartment to continue.')
  expect(helper).toBeInTheDocument()
  const fieldset = screen.getByRole('radiogroup') as HTMLFieldSetElement
  expect(fieldset).toHaveAttribute('aria-describedby', helper.id)
})

test('a valid file and a chosen apartment enable Submit', async () => {
  // Given the upload form is rendered and apartments have loaded
  const user = userEvent.setup()
  render(<ReceiptUpload />)
  await selectValidFile(user)

  // When the user also chooses an apartment
  await user.click(await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name }))

  // Then Submit is enabled and the helper text is gone
  expect(getSubmitButton()).toBeEnabled()
  expect(screen.queryByText('Choose an apartment to continue.')).not.toBeInTheDocument()
})

test('submitting sends the file and the chosen apartment_id in the upload request body', async () => {
  // Given a file and an apartment are chosen, and upload/extract will both succeed
  routeUploadAndExtract()
  const user = userEvent.setup()
  render(<ReceiptUpload />)
  const validFile = await selectValidFile(user)
  await user.click(await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[1].name }))

  // When the user clicks Submit
  await user.click(getSubmitButton())

  // Then the upload request body contains both the file and the chosen apartment_id
  await waitFor(() =>
    expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/receipts/upload'))).toBe(true),
  )
  const [, options] = fetchSpy.mock.calls.find(([url]) => String(url).endsWith('/receipts/upload'))!
  const body = options.body as FormData
  expect(body.get('file')).toBe(validFile)
  expect(body.get('apartment_id')).toBe(SAMPLE_APARTMENTS[1].id)
})

test('the chosen apartment survives Remove and selecting a new file', async () => {
  // Given a file and an apartment are chosen
  const user = userEvent.setup()
  render(<ReceiptUpload />)
  await selectValidFile(user)
  const secondOption = await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[1].name })
  await user.click(secondOption)
  expect(secondOption).toBeChecked()

  // When the user removes the file
  await user.click(screen.getByRole('button', { name: /^remove$/i }))

  // Then the apartment choice is still selected
  expect(screen.getByRole('radio', { name: SAMPLE_APARTMENTS[1].name })).toBeChecked()

  // When the user selects a new file
  await selectValidFile(user)

  // Then the apartment choice is still the one chosen before
  expect(screen.getByRole('radio', { name: SAMPLE_APARTMENTS[1].name })).toBeChecked()
  expect(getSubmitButton()).toBeEnabled()
})

test('the chosen apartment survives "Upload another receipt"', async () => {
  // Given a receipt was uploaded, extracted, and is now shown
  routeUploadAndExtract()
  const user = userEvent.setup()
  render(<ReceiptUpload />)
  await selectValidFile(user)
  await user.click(await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[1].name }))
  await user.click(getSubmitButton())
  await waitFor(() => expect(screen.getByText('Corner Store')).toBeInTheDocument())

  // When the user clicks "Upload another receipt"
  await user.click(screen.getByRole('button', { name: /upload another receipt/i }))

  // Then the previously chosen apartment is still selected
  expect(await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[1].name })).toBeChecked()
})

test('apartment load failure shows an error with Retry, and upload stays disabled', async () => {
  // Given the apartments request fails
  let callCount = 0
  fetchSpy.mockImplementation(
    withApartments(
      (urlString) => Promise.reject(new Error(`Unexpected fetch call to ${urlString}`)),
      () => {
        callCount += 1
        if (callCount === 1) {
          return Promise.resolve(jsonResponse(500, { detail: 'Internal error' }))
        }
        return Promise.resolve(jsonResponse(200, { items: SAMPLE_APARTMENTS, count: SAMPLE_APARTMENTS.length }))
      },
    ),
  )
  const user = userEvent.setup()
  render(<ReceiptUpload />)

  // Then an error with a Retry button is shown, and Submit stays disabled even with a valid file
  await waitFor(() => {
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load apartments. Please try again.')
  })
  await selectValidFile(user)
  expect(getSubmitButton()).toBeDisabled()
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()

  // When the user clicks Retry and the apartments load succeeds
  await user.click(screen.getByRole('button', { name: /retry/i }))

  // Then the apartment options appear and can now be chosen
  await user.click(await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name }))
  expect(getSubmitButton()).toBeEnabled()
})

test('arrow keys work: the options are real native radio inputs sharing one name group', async () => {
  // Given the upload form is rendered and apartments have loaded
  render(<ReceiptUpload />)
  const first = await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })
  const second = screen.getByRole('radio', { name: SAMPLE_APARTMENTS[1].name })

  // Then both options are real <input type="radio"> elements in the same
  // name group -- jsdom doesn't simulate the browser's native arrow-key
  // behavior for radio groups, but that behavior comes for free in a real
  // browser for exactly this markup, and only for exactly this markup.
  expect(first.tagName).toBe('INPUT')
  expect(first).toHaveAttribute('type', 'radio')
  expect(first).toHaveAttribute('name', 'apartment')
  expect(second).toHaveAttribute('type', 'radio')
  expect(second).toHaveAttribute('name', first.getAttribute('name'))
  expect(first).not.toBeDisabled()
  expect(second).not.toBeDisabled()
})
