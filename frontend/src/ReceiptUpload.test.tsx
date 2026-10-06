import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReceiptUpload from './ReceiptUpload'

function getFileInput() {
  return screen.getByLabelText(/upload receipt/i)
}

function getSubmitButton() {
  return screen.getByRole('button', { name: /submit|uploading/i })
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }
}

async function selectValidFile() {
  const user = userEvent.setup()
  render(<ReceiptUpload />)
  const validFile = new File(['dummy'], 'receipt.jpg', { type: 'image/jpeg' })
  await user.upload(getFileInput(), validFile)
  return { user, validFile }
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

  // When the user selects a file with an unsupported type (e.g. a .txt file)
  // Note: fireEvent is used instead of userEvent.upload because userEvent
  // respects the input's `accept` attribute and would silently skip a
  // non-matching file, never exercising the component's own validation.
  const invalidFile = new File(['dummy'], 'notes.txt', { type: 'text/plain' })
  fireEvent.change(getFileInput(), { target: { files: [invalidFile] } })

  // Then an inline error is shown, Submit stays disabled, and no filename is displayed
  expect(
    screen.getByText('Invalid file type. Please select a JPG, PNG, or PDF file.'),
  ).toBeInTheDocument()
  expect(getSubmitButton()).toBeDisabled()
  expect(screen.queryByText('Selected file: notes.txt')).not.toBeInTheDocument()
})

test('valid PDF: filename displayed, Submit enabled, no error shown', async () => {
  // Given the upload form is rendered
  const user = userEvent.setup()
  render(<ReceiptUpload />)

  // When the user selects a valid PDF (content starts with the PDF signature)
  const validFile = new File(['%PDF-1.4 fake but valid-looking pdf content'], 'receipt.pdf', {
    type: 'application/pdf',
  })
  await user.upload(getFileInput(), validFile)

  // Then the filename is displayed, Submit is enabled, and no error is shown
  await waitFor(() => {
    expect(screen.getByText('Selected file: receipt.pdf')).toBeInTheDocument()
  })
  expect(getSubmitButton()).toBeEnabled()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('invalid PDF: name ends in .pdf but content is not "%PDF-" -> inline error shown, Submit disabled, filename not displayed', async () => {
  // Given the upload form is rendered
  const user = userEvent.setup()
  render(<ReceiptUpload />)

  // When the user selects a file named like a PDF but whose content is not a real PDF
  const invalidPdf = new File(['this is not actually a pdf'], 'receipt.pdf', {
    type: 'application/pdf',
  })
  await user.upload(getFileInput(), invalidPdf)

  // Then an inline error is shown, Submit stays disabled, and no filename is displayed
  await waitFor(() => {
    expect(screen.getByText('This file does not look like a valid PDF.')).toBeInTheDocument()
  })
  expect(getSubmitButton()).toBeDisabled()
  expect(screen.queryByText('Selected file: receipt.pdf')).not.toBeInTheDocument()
})

describe('submitting to the backend', () => {
  let fetchSpy: jest.Mock

  beforeEach(() => {
    fetchSpy = jest.fn()
    global.fetch = fetchSpy as unknown as typeof fetch
  })

  afterEach(() => {
    // @ts-expect-error cleaning up the test-only global fetch stub
    delete global.fetch
  })

  test('valid file + server returns 201 -> success message with receipt_id shown', async () => {
    // Given a valid file is selected and the server will accept the upload
    fetchSpy.mockResolvedValue(
      jsonResponse(201, {
        receipt_id: 'abc-123',
        filename: 'receipt.jpg',
        content_type: 'image/jpeg',
        size_bytes: 5,
      }),
    )
    const { user } = await selectValidFile()

    // When the user clicks Submit
    await user.click(getSubmitButton())

    // Then a success message with the receipt_id and filename is shown
    await waitFor(() => {
      expect(
        screen.getByText('Upload successful. Receipt ID: abc-123 (receipt.jpg)'),
      ).toBeInTheDocument()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('valid file + server returns 400 with detail -> server error message shown', async () => {
    // Given a valid file is selected and the server rejects it with a 400 and a detail message
    fetchSpy.mockResolvedValue(jsonResponse(400, { detail: 'Unsupported file type.' }))
    const { user } = await selectValidFile()

    // When the user clicks Submit
    await user.click(getSubmitButton())

    // Then the server's detail message is shown in the inline error area
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Unsupported file type.')
    })
  })

  test('valid file + server returns 413 -> error shown', async () => {
    // Given a valid file is selected and the server rejects it with a 413 and a detail message
    fetchSpy.mockResolvedValue(
      jsonResponse(413, { detail: 'File exceeds the maximum size of 10 MB.' }),
    )
    const { user } = await selectValidFile()

    // When the user clicks Submit
    await user.click(getSubmitButton())

    // Then the server's detail message is shown in the inline error area
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'File exceeds the maximum size of 10 MB.',
      )
    })
  })

  test('valid file + fetch rejects (network error) -> "Could not reach the server" message shown, Submit enabled again', async () => {
    // Given a valid file is selected and the network request will fail outright
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'))
    const { user } = await selectValidFile()

    // When the user clicks Submit
    await user.click(getSubmitButton())

    // Then a generic "could not reach the server" message is shown and Submit is enabled again for retry
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Could not reach the server. Please try again.',
      )
    })
    expect(getSubmitButton()).toBeEnabled()
  })

  test('while the request is pending -> "Uploading..." shown and Submit disabled', async () => {
    // Given a valid file is selected and the server response has not resolved yet
    let resolveResponse: (value: unknown) => void = () => {}
    fetchSpy.mockReturnValue(
      new Promise((resolve) => {
        resolveResponse = resolve
      }),
    )
    const { user } = await selectValidFile()

    // When the user clicks Submit
    await user.click(getSubmitButton())

    // Then the button shows "Uploading..." and is disabled while the request is in flight
    const button = screen.getByRole('button', { name: /uploading/i })
    expect(button).toBeDisabled()
    expect(getFileInput()).toBeDisabled()

    resolveResponse(jsonResponse(201, { receipt_id: 'id', filename: 'receipt.jpg' }))
  })

  test('valid PDF + server returns 201 -> success message with receipt_id shown, request body contains the PDF file', async () => {
    // Given a valid PDF is selected and the server will accept the upload
    fetchSpy.mockResolvedValue(jsonResponse(201, { receipt_id: 'pdf-456', filename: 'receipt.pdf' }))
    const user = userEvent.setup()
    render(<ReceiptUpload />)
    const validPdf = new File(['%PDF-1.4 valid pdf content'], 'receipt.pdf', {
      type: 'application/pdf',
    })
    await user.upload(getFileInput(), validPdf)
    await waitFor(() => expect(screen.getByText('Selected file: receipt.pdf')).toBeInTheDocument())

    // When the user clicks Submit
    await user.click(getSubmitButton())

    // Then a success message with the receipt_id is shown, and the request body contains the PDF file
    await waitFor(() => {
      expect(
        screen.getByText('Upload successful. Receipt ID: pdf-456 (receipt.pdf)'),
      ).toBeInTheDocument()
    })
    const [, options] = fetchSpy.mock.calls[0]
    expect((options.body as FormData).get('file')).toBe(validPdf)
  })

  test('request is sent to ${VITE_API_URL}/receipts/upload with a FormData body containing the file', async () => {
    // Given a valid file is selected and the server will accept the upload
    fetchSpy.mockResolvedValue(
      jsonResponse(201, { receipt_id: 'abc-123', filename: 'receipt.jpg' }),
    )
    const { user, validFile } = await selectValidFile()

    // When the user clicks Submit
    await user.click(getSubmitButton())

    // Then the request is sent to the configured API URL with a FormData body containing the file
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    const [url, options] = fetchSpy.mock.calls[0]
    expect(url).toBe('http://localhost:8001/receipts/upload')
    expect(options.method).toBe('POST')
    expect(options.body).toBeInstanceOf(FormData)
    expect((options.body as FormData).get('file')).toBe(validFile)
  })
})
