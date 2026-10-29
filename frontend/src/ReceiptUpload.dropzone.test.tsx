import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ReceiptUpload from './ReceiptUpload'
import { mockObjectUrl } from './test/objectUrl'
import { SAMPLE_APARTMENTS, withApartments } from './test/apartmentsFetch'

beforeEach(() => {
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

// jsdom has neither URL.createObjectURL nor URL.revokeObjectURL; a dropped
// JPG/PNG now creates a preview object URL, so every test here needs this.
let objectUrl: ReturnType<typeof mockObjectUrl>
beforeEach(() => {
  objectUrl = mockObjectUrl()
})
afterEach(() => {
  objectUrl.restore()
})

// Every mount fires a GET /apartments (via useApartments); answer it with
// the default two-item success response so the dropzone itself can still be
// exercised without each test describing that route by hand.
beforeEach(() => {
  global.fetch = jest
    .fn()
    .mockImplementation(withApartments(() => Promise.reject(new Error('Unexpected fetch call')))) as unknown as typeof fetch
})
afterEach(() => {
  // @ts-expect-error cleaning up the test-only global fetch stub
  delete global.fetch
})

function getDropzone() {
  return screen.getByRole('button', { name: /drag a receipt here/i })
}

function getSubmitButton() {
  return screen.getByRole('button', { name: /read receipt|uploading|extracting/i })
}

/** Selects the first mocked apartment, needed alongside a file for Submit to enable. */
async function chooseApartment() {
  fireEvent.click(await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name }))
}

function makeDataTransfer(files: File[]) {
  return { dataTransfer: { files } }
}

test('dropping a valid file shows its name and enables the submit button once an apartment is also chosen', async () => {
  // Given the upload form is rendered
  render(<ReceiptUpload />)
  const validFile = new File(['dummy'], 'receipt.jpg', { type: 'image/jpeg' })

  // When a valid file is dropped on the zone
  fireEvent.drop(getDropzone(), makeDataTransfer([validFile]))

  // Then the filename is shown, but the submit button stays disabled until an apartment is chosen too
  await waitFor(() => {
    expect(screen.getByText('Selected file: receipt.jpg')).toBeInTheDocument()
  })
  expect(getSubmitButton()).toBeDisabled()

  // When the user also chooses an apartment
  await chooseApartment()

  // Then the submit button is enabled
  expect(getSubmitButton()).toBeEnabled()
})

test('dropping an invalid file shows the same error as choosing it', async () => {
  // Given the upload form is rendered
  render(<ReceiptUpload />)
  const invalidFile = new File(['dummy'], 'notes.txt', { type: 'text/plain' })

  // When an invalid file is dropped on the zone
  fireEvent.drop(getDropzone(), makeDataTransfer([invalidFile]))

  // Then the same inline error shown for an invalid chosen file is shown
  await waitFor(() => {
    expect(
      screen.getByText('Invalid file type. Please select a JPG, PNG, or PDF file.'),
    ).toBeInTheDocument()
  })
  expect(getSubmitButton()).toBeDisabled()
})

test('dropping two files at once shows a one-at-a-time error', async () => {
  // Given the upload form is rendered
  render(<ReceiptUpload />)
  const first = new File(['dummy'], 'receipt1.jpg', { type: 'image/jpeg' })
  const second = new File(['dummy'], 'receipt2.jpg', { type: 'image/jpeg' })

  // When two files are dropped on the zone
  fireEvent.drop(getDropzone(), makeDataTransfer([first, second]))

  // Then an error asking for one receipt at a time is shown, and no file is selected
  await waitFor(() => {
    expect(screen.getByText('Please drop one receipt at a time.')).toBeInTheDocument()
  })
  expect(getSubmitButton()).toBeDisabled()
  expect(screen.queryByText('Selected file: receipt1.jpg')).not.toBeInTheDocument()
})

test('Remove clears the selected file and any error', async () => {
  // Given a valid file has been dropped
  render(<ReceiptUpload />)
  const validFile = new File(['dummy'], 'receipt.jpg', { type: 'image/jpeg' })
  fireEvent.drop(getDropzone(), makeDataTransfer([validFile]))
  await waitFor(() => {
    expect(screen.getByText('Selected file: receipt.jpg')).toBeInTheDocument()
  })

  // When the user clicks Remove
  fireEvent.click(screen.getByRole('button', { name: /^remove$/i }))

  // Then the file and submit-enabling state are cleared
  expect(screen.queryByText('Selected file: receipt.jpg')).not.toBeInTheDocument()
  expect(getSubmitButton()).toBeDisabled()
})

test('Enter on the zone triggers the hidden file input', () => {
  // Given the upload form is rendered
  render(<ReceiptUpload />)
  const clickSpy = jest.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})

  // When the user presses Enter on the focused zone
  fireEvent.keyDown(getDropzone(), { key: 'Enter' })

  // Then the file input's picker is opened
  expect(clickSpy).toHaveBeenCalled()
  clickSpy.mockRestore()
})

test('the camera input accepts images, requests the environment camera, and validates like the main input', async () => {
  // Given the upload form is rendered
  const { container } = render(<ReceiptUpload />)
  const cameraInput = container.querySelector('input[capture]') as HTMLInputElement

  // Then it is set up for phone capture
  expect(cameraInput).toHaveAttribute('accept', 'image/*')
  expect(cameraInput).toHaveAttribute('capture', 'environment')

  // When an invalid file is "captured" through it
  const invalidFile = new File(['dummy'], 'notes.txt', { type: 'text/plain' })
  fireEvent.change(cameraInput, { target: { files: [invalidFile] } })

  // Then the same validation as the main input applies
  await waitFor(() => {
    expect(
      screen.getByText('Invalid file type. Please select a JPG, PNG, or PDF file.'),
    ).toBeInTheDocument()
  })
})
