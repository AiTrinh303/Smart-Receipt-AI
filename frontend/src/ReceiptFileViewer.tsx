import { useState } from 'react'
import { receiptFileUrl } from './api/receiptFileUrl'
import Button from './components/ui/Button'

const MIN_ZOOM = 50
const MAX_ZOOM = 300
const ZOOM_STEP = 25
const DEFAULT_ZOOM = 100

const NOT_AVAILABLE_MESSAGE = 'The original file is not available.'

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
  const kind = decideKind(contentType, fileName)

  const zoomIn = () => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))
  const zoomOut = () => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))
  const fit = () => setZoom(DEFAULT_ZOOM)

  const imageAlt = fileName ? `Original receipt image (${fileName})` : 'Original receipt image'

  return (
    <div className="flex flex-col gap-3">
      {kind === 'image' && !hasError && (
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-label="Zoom out"
            onClick={zoomOut}
            disabled={zoom <= MIN_ZOOM}
          >
            −
          </Button>
          <span className="min-w-[3.5rem] text-center text-sm text-ink-muted">{zoom}%</span>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Zoom in"
            onClick={zoomIn}
            disabled={zoom >= MAX_ZOOM}
          >
            +
          </Button>
          <Button variant="secondary" size="sm" aria-label="Fit" onClick={fit}>
            Fit
          </Button>
        </div>
      )}

      {hasError ? (
        <p className="text-sm text-ink-muted">{NOT_AVAILABLE_MESSAGE}</p>
      ) : kind === 'pdf' ? (
        <iframe
          src={fileUrl}
          title={fileName ? `Original receipt PDF (${fileName})` : 'Original receipt PDF'}
          className="h-[600px] w-full rounded-md border border-border"
        />
      ) : (
        <div className="max-h-[600px] overflow-auto rounded-md border border-border bg-surface-page">
          {!isLoaded && (
            <div className="flex h-48 items-center justify-center text-sm text-ink-muted">
              Loading image...
            </div>
          )}
          <img
            src={fileUrl}
            alt={imageAlt}
            style={{ width: `${zoom}%`, display: isLoaded ? 'block' : 'none' }}
            onLoad={() => setIsLoaded(true)}
            onError={() => setHasError(true)}
          />
        </div>
      )}

      {!hasError && (
        <a
          href={fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-brand underline"
        >
          Open original
        </a>
      )}
    </div>
  )
}

export default ReceiptFileViewer
