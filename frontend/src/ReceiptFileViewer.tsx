import { useState } from 'react'
import { receiptArchiveUrl } from './api/receiptArchiveUrl'
import { receiptFileUrl } from './api/receiptFileUrl'
import Alert from './components/ui/Alert'
import Button from './components/ui/Button'

const MIN_ZOOM = 50
const MAX_ZOOM = 300
const ZOOM_STEP = 25
const DEFAULT_ZOOM = 100

const NOT_AVAILABLE_MESSAGE = 'The original file is not available.'

const LINK_BUTTON_CLASSES =
  'inline-flex min-h-[44px] flex-shrink-0 items-center justify-center gap-1.5 rounded-md border ' +
  'border-border bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-slate-50 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ' +
  'sm:min-h-0 sm:py-1.5'

function getExtension(name: string): string {
  const index = name.lastIndexOf('.')
  return index === -1 ? '' : name.slice(index).toLowerCase()
}

type FileKind = 'image' | 'pdf'

function decideKind(contentType: string | null, fileName: string | null): FileKind {
  if (contentType === 'application/pdf') {
    return 'pdf'
  }
  if (contentType && contentType.startsWith('image/')) {
    return 'image'
  }

  if (fileName) {
    const extension = getExtension(fileName)
    if (extension === '.pdf') {
      return 'pdf'
    }
    if (extension === '.jpg' || extension === '.jpeg' || extension === '.png') {
      return 'image'
    }
  }

  // Neither a recognized content type nor a recognized extension: default
  // to image, since that is the far more common receipt format.
  return 'image'
}

function ZoomOutIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
      <circle cx="8.5" cy="8.5" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M13 13l4 4M6 8.5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function ZoomInIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
      <circle cx="8.5" cy="8.5" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M13 13l4 4M8.5 6v5M6 8.5h5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ExternalLinkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
      <path
        d="M8 4H4v12h12v-4M11 3h6v6M9 11l8-8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
      <path
        d="M10 3v9m0 0l-3.5-3.5M10 12l3.5-3.5M4 14.5v1a1 1 0 001 1h10a1 1 0 001-1v-1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface ReceiptFileViewerProps {
  receiptId: string
  fileName: string | null
  contentType: string | null
}

function ReceiptFileViewer({ receiptId, fileName, contentType }: ReceiptFileViewerProps) {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)

  const fileUrl = receiptFileUrl(receiptId)
  const archiveUrl = receiptArchiveUrl(receiptId)
  const kind = decideKind(contentType, fileName)

  const zoomIn = () => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))
  const zoomOut = () => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))
  const fit = () => setZoom(DEFAULT_ZOOM)

  const imageAlt = fileName ? `Original receipt image (${fileName})` : 'Original receipt image'

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        {fileName ? (
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink" title={fileName}>
            {fileName}
          </p>
        ) : (
          <span className="flex-1" />
        )}

        <div className="flex flex-shrink-0 items-center gap-2">
          {kind === 'image' && !hasError && (
            <div className="flex items-center gap-1">
              <Button
                variant="secondary"
                size="sm"
                aria-label="Zoom out"
                onClick={zoomOut}
                disabled={zoom <= MIN_ZOOM}
              >
                <ZoomOutIcon />
              </Button>
              <span className="min-w-[3rem] text-center text-sm text-ink-muted">{zoom}%</span>
              <Button
                variant="secondary"
                size="sm"
                aria-label="Zoom in"
                onClick={zoomIn}
                disabled={zoom >= MAX_ZOOM}
              >
                <ZoomInIcon />
              </Button>
              <Button variant="secondary" size="sm" aria-label="Fit" onClick={fit}>
                Fit
              </Button>
            </div>
          )}

          {!hasError && (
            <a href={fileUrl} target="_blank" rel="noopener noreferrer" className={LINK_BUTTON_CLASSES}>
              <ExternalLinkIcon />
              Open original
            </a>
          )}

          {!hasError && (
            // A plain <a href> -- the server's Content-Disposition:
            // attachment header triggers the browser's download directly,
            // so no fetch (and therefore no CORS) is needed here.
            <a href={archiveUrl} className={LINK_BUTTON_CLASSES}>
              <DownloadIcon />
              Download PDF
            </a>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-slate-100">
        {hasError ? (
          <div className="p-4">
            <Alert variant="info">{NOT_AVAILABLE_MESSAGE}</Alert>
          </div>
        ) : kind === 'pdf' ? (
          <iframe
            src={fileUrl}
            title={fileName ? `Original receipt PDF (${fileName})` : 'Original receipt PDF'}
            className="h-[600px] w-full lg:h-full lg:min-h-[600px]"
          />
        ) : (
          <div className="flex min-h-[200px] items-center justify-center p-4">
            {!isLoaded && <p className="text-sm text-ink-muted">Loading image...</p>}
            <img
              src={fileUrl}
              alt={imageAlt}
              style={{ width: `${zoom}%`, display: isLoaded ? 'block' : 'none' }}
              className="mx-auto"
              onLoad={() => setIsLoaded(true)}
              onError={() => setHasError(true)}
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default ReceiptFileViewer
