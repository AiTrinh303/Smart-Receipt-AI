import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReceiptUpload from './ReceiptUpload'

function getFileInput() {
  return screen.getByLabelText(/upload receipt/i)
}

function getSubmitButton() {
  return screen.getByRole('button', { name: /submit/i })
}

test('initial state: Submit is disabled when no file is selected', () => {
  // Given the upload form has just rendered
  render(<ReceiptUpload />)

  // When no file has been selected
  // (no action taken)

  // Then the Submit button is disabled
  expect(getSubmitButton()).toBeDisabled()
})

test('valid JPG: filename displayed, Submit enabled, no error shown', async () => {
  // Given the upload form is rendered
  const user = userEvent.setup()
  render(<ReceiptUpload />)

  // When the user selects a valid JPG file
  const validFile = new File(['dummy'], 'receipt.jpg', { type: 'image/jpeg' })
  await user.upload(getFileInput(), validFile)

  // Then the filename is displayed, Submit is enabled, and no error is shown
  expect(screen.getByText('Selected file: receipt.jpg')).toBeInTheDocument()
  expect(getSubmitButton()).toBeEnabled()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('valid PNG: filename displayed, Submit enabled', async () => {
  // Given the upload form is rendered
  const user = userEvent.setup()
  render(<ReceiptUpload />)

  // When the user selects a valid PNG file
  const validFile = new File(['dummy'], 'receipt.png', { type: 'image/png' })
  await user.upload(getFileInput(), validFile)

  // Then the filename is displayed and Submit is enabled
  expect(screen.getByText('Selected file: receipt.png')).toBeInTheDocument()
  expect(getSubmitButton()).toBeEnabled()
})

test('invalid type: inline error shown, Submit stays disabled, filename not displayed', () => {
  // Given the upload form is rendered
  render(<ReceiptUpload />)

  // When the user selects a file with an unsupported type (e.g. a PDF)
  // Note: fireEvent is used instead of userEvent.upload because userEvent
  // respects the input's `accept` attribute and would silently skip a
  // non-matching file, never exercising the component's own validation.
  const invalidFile = new File(['dummy'], 'receipt.pdf', { type: 'application/pdf' })
  fireEvent.change(getFileInput(), { target: { files: [invalidFile] } })

  // Then an inline error is shown, Submit stays disabled, and no filename is displayed
  expect(
    screen.getByText('Invalid file type. Please select a JPG or PNG image.'),
  ).toBeInTheDocument()
  expect(getSubmitButton()).toBeDisabled()
  expect(screen.queryByText('Selected file: receipt.pdf')).not.toBeInTheDocument()
})

test('valid submit: clicking Submit logs the file and makes no network request', async () => {
  // Given a valid file has been selected
  const user = userEvent.setup()
  const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  const fetchSpy = jest.fn()
  global.fetch = fetchSpy as unknown as typeof fetch

  render(<ReceiptUpload />)
  const validFile = new File(['dummy'], 'receipt.jpg', { type: 'image/jpeg' })
  await user.upload(getFileInput(), validFile)

  // When the user clicks Submit
  await user.click(getSubmitButton())

  // Then the file is logged to the console and no network request is made
  expect(consoleLogSpy).toHaveBeenCalledWith(validFile)
  expect(fetchSpy).not.toHaveBeenCalled()

  consoleLogSpy.mockRestore()
  // @ts-expect-error cleaning up the test-only global fetch stub
  delete global.fetch
})
