import { fireEvent, render, screen } from '@testing-library/react'
import ReceiptFileViewer from './ReceiptFileViewer'

const RECEIPT_ID = '11111111-1111-1111-1111-111111111111'
const EXPECTED_URL = `http://localhost:8001/receipts/${RECEIPT_ID}/file`

test('an image content type renders an <img> whose src is the file URL', () => {
  // Given a receipt known to be an image
  render(<ReceiptFileViewer receiptId={RECEIPT_ID} fileName="receipt.jpg" contentType="image/jpeg" />)

  // Then an <img> pointing at the file URL is rendered
  const img = screen.getByRole('img', { hidden: true }) as HTMLImageElement
  expect(img.src).toBe(EXPECTED_URL)
})

test('a PDF content type renders an iframe with that src and a title', () => {
  // Given a receipt known to be a PDF
  render(<ReceiptFileViewer receiptId={RECEIPT_ID} fileName="receipt.pdf" contentType="application/pdf" />)

  // Then an iframe with the file URL and a descriptive title is rendered
  const iframe = screen.getByTitle(/original receipt pdf/i) as HTMLIFrameElement
  expect(iframe.tagName).toBe('IFRAME')
  expect(iframe.src).toBe(EXPECTED_URL)
})

test('kind is decided from contentType first, then the filename extension, then defaults to image', () => {
  // Given contentType is unknown but the filename has a .pdf extension
  const { rerender } = render(
    <ReceiptFileViewer receiptId={RECEIPT_ID} fileName="receipt.pdf" contentType={null} />,
  )
  expect(screen.getByTitle(/original receipt pdf/i)).toBeInTheDocument()

  // When neither contentType nor a recognized extension is available
  rerender(<ReceiptFileViewer receiptId={RECEIPT_ID} fileName={null} contentType={null} />)

  // Then it falls back to rendering an image
  expect(screen.getByRole('img', { hidden: true })).toBeInTheDocument()
})

test('an unknown content type with an unknown extension falls back to image', () => {
  render(
    <ReceiptFileViewer
      receiptId={RECEIPT_ID}
      fileName="receipt.unknownext"
      contentType="application/octet-stream"
    />,
  )
  expect(screen.getByRole('img', { hidden: true })).toBeInTheDocument()
})

test('zoom in and out change the image width and stop at the limits', () => {
  render(<ReceiptFileViewer receiptId={RECEIPT_ID} fileName="receipt.jpg" contentType="image/jpeg" />)
  const img = screen.getByRole('img', { hidden: true }) as HTMLImageElement
  expect(img.style.width).toBe('100%')

  // When the user zooms in once
  fireEvent.click(screen.getByRole('button', { name: /zoom in/i }))
  expect(img.style.width).toBe('125%')

  // When the user zooms in repeatedly past the maximum
  for (let i = 0; i < 10; i += 1) {
    fireEvent.click(screen.getByRole('button', { name: /zoom in/i }))
  }
  expect(img.style.width).toBe('300%')
  expect(screen.getByRole('button', { name: /zoom in/i })).toBeDisabled()

  // When the user zooms out repeatedly past the minimum
  for (let i = 0; i < 20; i += 1) {
    fireEvent.click(screen.getByRole('button', { name: /zoom out/i }))
  }
  expect(img.style.width).toBe('50%')
  expect(screen.getByRole('button', { name: /zoom out/i })).toBeDisabled()
})

test('Fit resets the zoom to 100%', () => {
  render(<ReceiptFileViewer receiptId={RECEIPT_ID} fileName="receipt.jpg" contentType="image/jpeg" />)
  const img = screen.getByRole('img', { hidden: true }) as HTMLImageElement

  fireEvent.click(screen.getByRole('button', { name: /zoom in/i }))
  fireEvent.click(screen.getByRole('button', { name: /zoom in/i }))
  expect(img.style.width).toBe('150%')

  fireEvent.click(screen.getByRole('button', { name: /^fit$/i }))
  expect(img.style.width).toBe('100%')
})

test('the "Open original" link has the right href, target and rel', () => {
  render(<ReceiptFileViewer receiptId={RECEIPT_ID} fileName="receipt.jpg" contentType="image/jpeg" />)
  const link = screen.getByRole('link', { name: /open original/i })
  expect(link).toHaveAttribute('href', EXPECTED_URL)
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
})

test('onError shows the "not available" message and no <img>', () => {
  render(<ReceiptFileViewer receiptId={RECEIPT_ID} fileName="receipt.jpg" contentType="image/jpeg" />)
  const img = screen.getByRole('img', { hidden: true })

  // When the image fails to load
  fireEvent.error(img)

  // Then the not-available message is shown and the image is gone
  expect(screen.getByText('The original file is not available.')).toBeInTheDocument()
  expect(screen.queryByRole('img', { hidden: true })).not.toBeInTheDocument()
})
