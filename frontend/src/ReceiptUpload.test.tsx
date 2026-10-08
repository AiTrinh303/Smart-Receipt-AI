import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReceiptUpload from './ReceiptUpload'

function getFileInput() {
  return screen.getByLabelText(/upload receipt/i)
}

function getSubmitButton() {
  return screen.getByRole('button', { name: /submit|uploading|extracting/i })
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

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

/** Routes the mocked global.fetch by URL, so upload and extract calls can be
 * answered independently within a single test. */
function routeFetch(
  fetchSpy: jest.Mock,
  routes: { upload?: () => Promise<unknown>; extract?: () => Promise<unknown> },
) {
  fetchSpy.mockImplementation((url: unknown) => {
    const urlString = String(url)
    if (urlString.endsWith('/receipts/upload')) {
      return routes.upload
        ? routes.upload()
        : Promise.reject(new Error(`Unexpected upload call to ${urlString}`))
    }
    if (urlString.includes('/extract')) {
      return routes.extract
        ? routes.extract()
        : Promise.reject(new Error(`Unexpected extract call to ${urlString}`))
    }
    return Promise.reject(new Error(`Unexpected fetch call to ${urlString}`))
  })
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

  test('valid file + server returns 400 with detail -> server error message shown', async () => {
    // Given a valid file is selected and the server rejects the upload with a 400 and a detail message
    fetchSpy.mockResolvedValue(jsonResponse(400, { detail: 'Unsupported file type.' }))
    const { user } = await selectValidFile()

    // When the user clicks Submit
    await user.click(getSubmitButton())

    // Then the server's detail message is shown in the inline error area, and extraction is never attempted
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Unsupported file type.')
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('valid file + server returns 413 -> error shown', async () => {
    // Given a valid file is selected and the server rejects the upload with a 413 and a detail message
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

  test('valid file + upload fetch rejects (network error) -> "Could not reach the server" message shown, Submit enabled again', async () => {
    // Given a valid file is selected and the upload request will fail outright
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

  test('while the upload request is pending -> "Uploading..." shown and Submit disabled', async () => {
    // Given a valid file is selected and the upload response has not resolved yet
    const uploadDeferred = createDeferred<unknown>()
    routeFetch(fetchSpy, {
      upload: () => uploadDeferred.promise,
      extract: () =>
        Promise.resolve(jsonResponse(200, { receipt_id: 'id', items: [], discounts: [], taxes: [] })),
    })
    const { user } = await selectValidFile()

    // When the user clicks Submit
    await user.click(getSubmitButton())

    // Then the button shows "Uploading..." and is disabled while the request is in flight
    const button = screen.getByRole('button', { name: /uploading/i })
    expect(button).toBeDisabled()
    expect(getFileInput()).toBeDisabled()

    // Cleanup: let the upload (and the extraction it triggers) settle before the test ends
    uploadDeferred.resolve(jsonResponse(201, { receipt_id: 'id', filename: 'receipt.jpg' }))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2))
  })

  test('upload succeeds then extraction succeeds -> result view shown', async () => {
    // Given a valid file is selected, the upload will succeed, and extraction will later succeed
    const uploadDeferred = createDeferred<unknown>()
    const extractDeferred = createDeferred<unknown>()
    routeFetch(fetchSpy, {
      upload: () => uploadDeferred.promise,
      extract: () => extractDeferred.promise,
    })
    const { user } = await selectValidFile()

    // When the user clicks Submit and the upload resolves
    await user.click(getSubmitButton())
    uploadDeferred.resolve(jsonResponse(201, { receipt_id: 'abc-123', filename: 'receipt.jpg' }))

    // Then the short upload success message appears while extraction begins
    await waitFor(() => {
      expect(
        screen.getByText('Upload successful. Receipt ID: abc-123 (receipt.jpg)'),
      ).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByText('Extracting receipt data...')).toBeInTheDocument()
    })

    // When extraction resolves with the receipt data
    extractDeferred.resolve(
      jsonResponse(200, {
        receipt_id: 'abc-123',
        store_name: 'Corner Store',
        purchase_date: '2026-01-15',
        currency: 'USD',
        items: [{ name: 'Milk', quantity: 1, unit_price: 2.5, line_total: 2.5 }],
        discounts: [],
        taxes: [],
        total: 2.5,
      }),
    )

    // Then the result view is shown with the extracted data
    await waitFor(() => {
      expect(screen.getByText('Corner Store')).toBeInTheDocument()
    })
    expect(screen.getByText('Milk')).toBeInTheDocument()
  })

  test('while extraction is pending -> "Extracting receipt data..." shown and Submit disabled', async () => {
    // Given the upload has succeeded and extraction has not resolved yet
    const extractDeferred = createDeferred<unknown>()
    routeFetch(fetchSpy, {
      upload: () => Promise.resolve(jsonResponse(201, { receipt_id: 'abc-123', filename: 'receipt.jpg' })),
      extract: () => extractDeferred.promise,
    })
    const { user } = await selectValidFile()

    // When the user clicks Submit
    await user.click(getSubmitButton())

    // Then "Extracting receipt data..." is shown and Submit is disabled
    await waitFor(() => {
      expect(screen.getByText('Extracting receipt data...')).toBeInTheDocument()
    })
    expect(getSubmitButton()).toBeDisabled()
    expect(getFileInput()).toBeDisabled()

    // Cleanup: resolve so the test doesn't leave a dangling promise
    extractDeferred.resolve(
      jsonResponse(200, { receipt_id: 'abc-123', items: [], discounts: [], taxes: [] }),
    )
    await waitFor(() =>
      expect(screen.queryByText('Extracting receipt data...')).not.toBeInTheDocument(),
    )
  })

  test('extraction returns 502 -> extraction error shown with Retry; clicking Retry calls only the extract endpoint again', async () => {
    // Given upload succeeds and the first extraction attempt fails with a 502
    let extractCallCount = 0
    routeFetch(fetchSpy, {
      upload: () => Promise.resolve(jsonResponse(201, { receipt_id: 'abc-123', filename: 'receipt.jpg' })),
      extract: () => {
        extractCallCount += 1
        if (extractCallCount === 1) {
          return Promise.resolve(
            jsonResponse(502, { detail: 'Receipt extraction failed. Please try again.' }),
          )
        }
        return Promise.resolve(
          jsonResponse(200, {
            receipt_id: 'abc-123',
            store_name: 'Corner Store',
            items: [],
            discounts: [],
            taxes: [],
          }),
        )
      },
    })
    const { user } = await selectValidFile()

    // When the user clicks Submit
    await user.click(getSubmitButton())

    // Then an extraction-specific error message (distinct from upload errors) is shown with a Retry button
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'We could not read this receipt. Please try again or upload a clearer image.',
      )
    })
    const uploadCallsBeforeRetry = fetchSpy.mock.calls.filter(([url]) =>
      String(url).endsWith('/receipts/upload'),
    ).length

    // When the user clicks Retry
    await user.click(screen.getByRole('button', { name: /retry/i }))

    // Then only the extract endpoint is called again (no second upload), and the result is shown
    await waitFor(() => {
      expect(screen.getByText('Corner Store')).toBeInTheDocument()
    })
    const uploadCallsAfterRetry = fetchSpy.mock.calls.filter(([url]) =>
      String(url).endsWith('/receipts/upload'),
    ).length
    expect(uploadCallsAfterRetry).toBe(uploadCallsBeforeRetry)
    expect(extractCallCount).toBe(2)
  })

  test('extraction returns 503 -> "AI service is not configured" message shown', async () => {
    // Given upload succeeds and extraction fails because the AI service has no key configured
    routeFetch(fetchSpy, {
      upload: () => Promise.resolve(jsonResponse(201, { receipt_id: 'abc-123', filename: 'receipt.jpg' })),
      extract: () =>
        Promise.resolve(jsonResponse(503, { detail: 'Receipt extraction is not configured.' })),
    })
    const { user } = await selectValidFile()

    // When the user clicks Submit
    await user.click(getSubmitButton())

    // Then a message specifically about the AI service not being configured is shown
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The AI service is not configured. Please try again later.',
      )
    })
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  test('extraction network failure -> "Could not reach the server" message shown', async () => {
    // Given upload succeeds and the extraction request fails outright
    routeFetch(fetchSpy, {
      upload: () => Promise.resolve(jsonResponse(201, { receipt_id: 'abc-123', filename: 'receipt.jpg' })),
      extract: () => Promise.reject(new TypeError('Failed to fetch')),
    })
    const { user } = await selectValidFile()

    // When the user clicks Submit
    await user.click(getSubmitButton())

    // Then the same generic network-failure message used for upload is shown
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Could not reach the server. Please try again.',
      )
    })
  })

  test('"Upload another receipt" resets to the initial state', async () => {
    // Given the user has reached the result view after a successful upload and extraction
    routeFetch(fetchSpy, {
      upload: () => Promise.resolve(jsonResponse(201, { receipt_id: 'abc-123', filename: 'receipt.jpg' })),
      extract: () =>
        Promise.resolve(
          jsonResponse(200, {
            receipt_id: 'abc-123',
            store_name: 'Corner Store',
            items: [],
            discounts: [],
            taxes: [],
          }),
        ),
    })
    const { user } = await selectValidFile()
    await user.click(getSubmitButton())
    await waitFor(() => {
      expect(screen.getByText('Corner Store')).toBeInTheDocument()
    })

    // When the user clicks "Upload another receipt"
    await user.click(screen.getByRole('button', { name: /upload another receipt/i }))

    // Then the view resets to the initial upload form, with no file selected and no result shown
    expect(screen.getByLabelText(/upload receipt/i)).toBeInTheDocument()
    expect(getSubmitButton()).toBeDisabled()
    expect(screen.queryByText('Corner Store')).not.toBeInTheDocument()
  })

  test('valid PDF submit sends the PDF file in the upload request body', async () => {
    // Given a valid PDF is selected and both the upload and the extraction it triggers will succeed
    routeFetch(fetchSpy, {
      upload: () => Promise.resolve(jsonResponse(201, { receipt_id: 'pdf-456', filename: 'receipt.pdf' })),
      extract: () =>
        Promise.resolve(jsonResponse(200, { receipt_id: 'pdf-456', items: [], discounts: [], taxes: [] })),
    })
    const user = userEvent.setup()
    render(<ReceiptUpload />)
    const validPdf = new File(['%PDF-1.4 valid pdf content'], 'receipt.pdf', {
      type: 'application/pdf',
    })
    await user.upload(getFileInput(), validPdf)
    await waitFor(() => expect(screen.getByText('Selected file: receipt.pdf')).toBeInTheDocument())

    // When the user clicks Submit
    await user.click(getSubmitButton())

    // Then the upload request body contains the PDF file
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const [, options] = fetchSpy.mock.calls[0]
    expect((options.body as FormData).get('file')).toBe(validPdf)
  })

  test('request is sent to ${VITE_API_URL}/receipts/upload with a FormData body containing the file', async () => {
    // Given a valid file is selected and both the upload and the extraction it triggers will succeed
    routeFetch(fetchSpy, {
      upload: () => Promise.resolve(jsonResponse(201, { receipt_id: 'abc-123', filename: 'receipt.jpg' })),
      extract: () =>
        Promise.resolve(jsonResponse(200, { receipt_id: 'abc-123', items: [], discounts: [], taxes: [] })),
    })
    const { user, validFile } = await selectValidFile()

    // When the user clicks Submit
    await user.click(getSubmitButton())

    // Then the request is sent to the configured API URL with a FormData body containing the file
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const [url, options] = fetchSpy.mock.calls[0]
    expect(url).toBe('http://localhost:8001/receipts/upload')
    expect(options.method).toBe('POST')
    expect(options.body).toBeInstanceOf(FormData)
    expect((options.body as FormData).get('file')).toBe(validFile)
  })
})
