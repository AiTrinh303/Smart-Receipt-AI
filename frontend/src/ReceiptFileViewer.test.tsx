import { fireEvent, render, screen } from '@testing-library/react'
import ReceiptFileViewer, { PDF_VIEW_FRAGMENT } from './ReceiptFileViewer'

const RECEIPT_ID = '11111111-1111-1111-1111-111111111111'
const EXPECTED_URL = `http://localhost:8001/receipts/${RECEIPT_ID}/file`
const EXPECTED_ARCHIVE_URL = `http://localhost:8001/receipts/${RECEIPT_ID}/archive.pdf`

test('the file name is shown, truncated, with the full name in a title attribute', () => {
  render(
    <ReceiptFileViewer
      receiptId={RECEIPT_ID}
      fileName="a-very-long-original-receipt-filename.jpg"
      contentType="image/jpeg"
    />,
  )

  const name = screen.getByTitle('a-very-long-original-receipt-filename.jpg')
  expect(name).toHaveTextContent('a-very-long-original-receipt-filename.jpg')
  expect(name.className).toMatch(/truncate/)
})

test('when the file name is unknown, no name element is shown', () => {
  render(<ReceiptFileViewer receiptId={RECEIPT_ID} fileName={null} contentType="image/jpeg" />)
  expect(screen.queryByTitle(/.+/)).not.toBeInTheDocument()
})

test('an image content type renders an <img> whose src is the file URL', () => {
  // Given a receipt known to be an image
  render(<ReceiptFileViewer receiptId={RECEIPT_ID} fileName="receipt.jpg" contentType="image/jpeg" />)

  // Then an <img> pointing at the file URL is rendered
  const img = screen.getByRole('img', { hidden: true }) as HTMLImageElement
  expect(img.src).toBe(EXPECTED_URL)
})

test('a PDF content type renders an iframe with that src (plus the PDF view fragment) and a title', () => {
  // Given a receipt known to be a PDF
  render(<ReceiptFileViewer receiptId={RECEIPT_ID} fileName="receipt.pdf" contentType="application/pdf" />)

  // Then an iframe with the file URL -- plus PDF_VIEW_FRAGMENT, so Chrome/
  // Edge fit the page to width and hide the thumbnail panel -- and a
  // descriptive title is rendered
  const iframe = screen.getByTitle(/original receipt pdf/i) as HTMLIFrameElement
  expect(iframe.tagName).toBe('IFRAME')
  expect(iframe.src).toBe(`${EXPECTED_URL}${PDF_VIEW_FRAGMENT}`)
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

test('"Download PDF" has the exact archive.pdf href for an image receipt', () => {
  render(<ReceiptFileViewer receiptId={RECEIPT_ID} fileName="receipt.jpg" contentType="image/jpeg" />)
  const link = screen.getByRole('link', { name: /download pdf/i })
  expect(link).toHaveAttribute('href', EXPECTED_ARCHIVE_URL)
})

test('"Download PDF" has the exact archive.pdf href for a PDF receipt', () => {
  render(<ReceiptFileViewer receiptId={RECEIPT_ID} fileName="receipt.pdf" contentType="application/pdf" />)
  const link = screen.getByRole('link', { name: /download pdf/i })
  expect(link).toHaveAttribute('href', EXPECTED_ARCHIVE_URL)
})

test('"Download PDF" is hidden when the image fails to load', () => {
  render(<ReceiptFileViewer receiptId={RECEIPT_ID} fileName="receipt.jpg" contentType="image/jpeg" />)
  const img = screen.getByRole('img', { hidden: true })

  // When the image fails to load
  fireEvent.error(img)

  // Then "Download PDF" (and "Open original") are both gone
  expect(screen.queryByRole('link', { name: /download pdf/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /open original/i })).not.toBeInTheDocument()
})

test('"Open original" keeps its exact href, target and rel next to "Download PDF"', () => {
  render(<ReceiptFileViewer receiptId={RECEIPT_ID} fileName="receipt.jpg" contentType="image/jpeg" />)
  const openOriginal = screen.getByRole('link', { name: /open original/i })
  expect(openOriginal).toHaveAttribute('href', EXPECTED_URL)
  expect(openOriginal).toHaveAttribute('target', '_blank')
  expect(openOriginal).toHaveAttribute('rel', 'noopener noreferrer')
  expect(screen.getByRole('link', { name: /download pdf/i })).toBeInTheDocument()
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

// --- Rotate (view only) ----------------------------------------------------

const OTHER_RECEIPT_ID = '22222222-2222-2222-2222-222222222222'

/** The <img> is re-created when it moves into/out of the rotation wrapper,
 * so tests re-query it after each rotation instead of keeping a reference. */
function currentImage(): HTMLImageElement {
  return screen.getByRole('img', { hidden: true }) as HTMLImageElement
}

/** jsdom never decodes images, so naturalWidth/naturalHeight are 0; stub
 * them on the element before firing load, as a real browser would set them. */
function loadImageWithSize(img: HTMLElement, width: number, height: number) {
  Object.defineProperty(img, 'naturalWidth', { configurable: true, value: width })
  Object.defineProperty(img, 'naturalHeight', { configurable: true, value: height })
  fireEvent.load(img)
}

test('an image shows a "Rotate" button with visible text and a descriptive accessible name', () => {
  // Given an image receipt
  render(<ReceiptFileViewer receiptId={RECEIPT_ID} fileName="receipt.jpg" contentType="image/jpeg" />)

  // Then the Rotate button is there, named "Rotate 90 degrees clockwise", showing "Rotate"
  const button = screen.getByRole('button', { name: 'Rotate 90 degrees clockwise' })
  expect(button).toHaveTextContent('Rotate')
})

test('a PDF shows no "Rotate" button', () => {
  // Given a PDF receipt
  render(<ReceiptFileViewer receiptId={RECEIPT_ID} fileName="receipt.pdf" contentType="application/pdf" />)

  // Then there is no Rotate button
  expect(screen.queryByRole('button', { name: /rotate/i })).not.toBeInTheDocument()
})

test('rotating a loaded landscape image 90 degrees lays it out in the rotated shape, at the current zoom', () => {
  // Given a loaded 1200x800 (landscape) image
  render(<ReceiptFileViewer receiptId={RECEIPT_ID} fileName="receipt.jpg" contentType="image/jpeg" />)
  const img = screen.getByRole('img', { hidden: true }) as HTMLImageElement
  loadImageWithSize(img, 1200, 800)

  // When it is rotated once
  fireEvent.click(screen.getByRole('button', { name: 'Rotate 90 degrees clockwise' }))

  // Then a wrapper takes the rotated (portrait) shape at 100% of the panel width
  const rotated = currentImage()
  const wrapper = rotated.parentElement as HTMLElement
  expect(wrapper.style.width).toBe('100%')
  expect(wrapper.style.aspectRatio).toBe('800 / 1200')
  // And the image itself is sized so its height fills that width, then rotated
  expect(rotated.style.width).toBe('150%')
  expect(rotated.style.transform).toBe('translate(-50%, -50%) rotate(90deg)')
})

test('zoom and Fit size the rotated image, keeping the rotation', () => {
  // Given a loaded image rotated 90 degrees
  render(<ReceiptFileViewer receiptId={RECEIPT_ID} fileName="receipt.jpg" contentType="image/jpeg" />)
  const img = screen.getByRole('img', { hidden: true }) as HTMLImageElement
  loadImageWithSize(img, 1200, 800)
  fireEvent.click(screen.getByRole('button', { name: 'Rotate 90 degrees clockwise' }))

  // When zooming in, the rotated image's width grows
  fireEvent.click(screen.getByRole('button', { name: /zoom in/i }))
  expect((currentImage().parentElement as HTMLElement).style.width).toBe('125%')

  // When Fit is clicked, it fits the panel width again, still rotated
  fireEvent.click(screen.getByRole('button', { name: /^fit$/i }))
  expect((currentImage().parentElement as HTMLElement).style.width).toBe('100%')
  expect(currentImage().style.transform).toContain('rotate(90deg)')
})

test('four rotations return to the original, unwrapped image', () => {
  // Given a loaded image
  render(<ReceiptFileViewer receiptId={RECEIPT_ID} fileName="receipt.jpg" contentType="image/jpeg" />)
  const img = screen.getByRole('img', { hidden: true }) as HTMLImageElement
  loadImageWithSize(img, 1200, 800)
  const button = screen.getByRole('button', { name: 'Rotate 90 degrees clockwise' })

  // When rotated twice, it is turned upside down with the same layout box
  fireEvent.click(button)
  fireEvent.click(button)
  expect(currentImage().style.transform).toBe('rotate(180deg)')
  expect(currentImage().style.width).toBe('100%')

  // When rotated twice more, it is back to the original
  fireEvent.click(button)
  fireEvent.click(button)
  expect(currentImage().style.transform).toBe('')
  expect(currentImage().style.width).toBe('100%')
})

test('rotation resets when another receipt loads into the same viewer, and never makes a request', () => {
  const originalFetch = globalThis.fetch
  const fetchSpy = jest.fn()
  globalThis.fetch = fetchSpy as unknown as typeof fetch
  // Given a rotated image
  const { rerender } = render(
    <ReceiptFileViewer receiptId={RECEIPT_ID} fileName="receipt.jpg" contentType="image/jpeg" />,
  )
  loadImageWithSize(screen.getByRole('img', { hidden: true }), 1200, 800)
  fireEvent.click(screen.getByRole('button', { name: 'Rotate 90 degrees clockwise' }))
  expect(currentImage().style.transform).toContain('rotate(90deg)')

  // When another receipt is shown without remounting (as Previous/Next in review mode does)
  rerender(<ReceiptFileViewer receiptId={OTHER_RECEIPT_ID} fileName="other.jpg" contentType="image/jpeg" />)

  // Then the new image is not rotated
  const img = screen.getByRole('img', { hidden: true }) as HTMLImageElement
  expect(img.style.transform).toBe('')
  expect(img.style.width).toBe('100%')
  // And rotating never sent anything to the server
  expect(fetchSpy).not.toHaveBeenCalled()
  globalThis.fetch = originalFetch
})
