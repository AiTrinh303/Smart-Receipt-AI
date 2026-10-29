import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReceiptUpload from './ReceiptUpload'
import { mockObjectUrl } from './test/objectUrl'

beforeEach(() => {
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

function getFileInput() {
  return screen.getByLabelText(/upload receipt/i)
}

let objectUrl: ReturnType<typeof mockObjectUrl>
beforeEach(() => {
  objectUrl = mockObjectUrl()
})
afterEach(() => {
  objectUrl.restore()
})

test('a valid PNG shows an <img> preview with the expected alt text and the mocked URL', async () => {
  // Given a valid PNG file
  const user = userEvent.setup()
  render(<ReceiptUpload />)
  const validPng = new File(['dummy'], 'receipt.png', { type: 'image/png' })

  // When it is selected
  await user.upload(getFileInput(), validPng)

  // Then a preview <img> is shown with the expected alt text and object URL
  const img = screen.getByAltText('Preview of the selected receipt') as HTMLImageElement
  expect(img.src).toBe('blob:mock-url-0')
  expect(objectUrl.createObjectURL).toHaveBeenCalledWith(validPng)
})

test('a PDF shows no <img> preview', async () => {
  // Given a valid PDF file
  const user = userEvent.setup()
  render(<ReceiptUpload />)
  const validPdf = new File(['%PDF-1.4 valid pdf content'], 'receipt.pdf', {
    type: 'application/pdf',
  })

  // When it is selected
  await user.upload(getFileInput(), validPdf)

  // Then no preview image is shown, and createObjectURL was never called
  expect(screen.queryByAltText('Preview of the selected receipt')).not.toBeInTheDocument()
  expect(objectUrl.createObjectURL).not.toHaveBeenCalled()
})

test('an invalid file is never previewed and createObjectURL is never called', () => {
  // Given a file that fails validation
  render(<ReceiptUpload />)
  const invalidFile = new File(['dummy'], 'notes.txt', { type: 'text/plain' })

  // When it is selected
  fireEvent.change(getFileInput(), { target: { files: [invalidFile] } })

  // Then no preview is shown and createObjectURL was never called
  expect(screen.queryByAltText('Preview of the selected receipt')).not.toBeInTheDocument()
  expect(objectUrl.createObjectURL).not.toHaveBeenCalled()
})

test('Remove revokes the preview object URL', async () => {
  // Given a valid PNG has been selected and previewed
  const user = userEvent.setup()
  render(<ReceiptUpload />)
  const validPng = new File(['dummy'], 'receipt.png', { type: 'image/png' })
  await user.upload(getFileInput(), validPng)
  expect(screen.getByAltText('Preview of the selected receipt')).toBeInTheDocument()

  // When the user clicks Remove
  await user.click(screen.getByRole('button', { name: /^remove$/i }))

  // Then the object URL is revoked and the preview is gone
  expect(objectUrl.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url-0')
  expect(screen.queryByAltText('Preview of the selected receipt')).not.toBeInTheDocument()
})

test('selecting a new file revokes the previous preview object URL', async () => {
  // Given a valid PNG has been selected and previewed
  const user = userEvent.setup()
  render(<ReceiptUpload />)
  const first = new File(['dummy'], 'first.png', { type: 'image/png' })
  await user.upload(getFileInput(), first)
  expect(screen.getByAltText('Preview of the selected receipt')).toBeInTheDocument()

  // When a second valid file replaces it
  const second = new File(['dummy'], 'second.png', { type: 'image/png' })
  await user.upload(getFileInput(), second)

  // Then the first object URL was revoked and a new one is shown
  expect(objectUrl.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url-0')
  const img = screen.getByAltText('Preview of the selected receipt') as HTMLImageElement
  expect(img.src).toBe('blob:mock-url-1')
})

test('"Upload another receipt" after a reset revokes the preview object URL', async () => {
  // Given a valid PNG has been selected (never submitted, just to create a preview)
  const user = userEvent.setup()
  const fetchSpy = jest.fn()
  global.fetch = fetchSpy as unknown as typeof fetch
  fetchSpy.mockImplementation((url: unknown) => {
    const urlString = String(url)
    if (urlString.endsWith('/receipts/upload')) {
      return Promise.resolve({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ receipt_id: 'abc-123', filename: 'receipt.png' }),
      })
    }
    if (urlString.includes('/extract')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            receipt_id: 'abc-123',
            store_name: 'Corner Store',
            items: [],
            discounts: [],
            taxes: [],
            warnings: [],
            edited: false,
            edited_at: null,
          }),
      })
    }
    return Promise.reject(new Error(`Unexpected fetch call to ${urlString}`))
  })

  render(<ReceiptUpload />)
  const validPng = new File(['dummy'], 'receipt.png', { type: 'image/png' })
  await user.upload(getFileInput(), validPng)
  await user.click(screen.getByRole('button', { name: /read receipt/i }))

  await screen.findByText('Corner Store')

  // When the user clicks "Upload another receipt"
  await user.click(screen.getByRole('button', { name: /upload another receipt/i }))

  // Then the preview object URL created for the submitted file was revoked
  expect(objectUrl.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url-0')

  // @ts-expect-error cleaning up the test-only global fetch stub
  delete global.fetch
})

test('unmounting revokes any live preview object URL', async () => {
  // Given a valid PNG has been selected and previewed
  const user = userEvent.setup()
  const { unmount } = render(<ReceiptUpload />)
  const validPng = new File(['dummy'], 'receipt.png', { type: 'image/png' })
  await user.upload(getFileInput(), validPng)
  expect(objectUrl.revokeObjectURL).not.toHaveBeenCalled()

  // When the component unmounts
  unmount()

  // Then the live object URL is revoked
  expect(objectUrl.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url-0')
})
