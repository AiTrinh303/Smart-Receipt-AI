import { useState, type CSSProperties } from 'react'
import { receiptArchiveUrl } from './api/receiptArchiveUrl'
import { receiptFileUrl } from './api/receiptFileUrl'
import Alert from './components/ui/Alert'
import Button from './components/ui/Button'

const MIN_ZOOM = 50
const MAX_ZOOM = 300
const ZOOM_STEP = 25
const DEFAULT_ZOOM = 100

const NOT_AVAILABLE_MESSAGE = 'The original file is not available.'

/** Appended to the PDF iframe's src: Chrome and Edge honor these PDF open
 * parameters (fit the page to the viewport width, hide the side thumbnail
 * panel) to avoid the double toolbar/horizontal scrollbar/large empty area
 * their default plugin viewer otherwise shows at this iframe's width;
 * other browsers simply ignore an unrecognized fragment, which is
 * harmless. Never hides the browser's own PDF toolbar. */
export const PDF_VIEW_FRAGMENT = '#view=FitH&navpanes=0'

/** "Open original"/"Download PDF" stay real links (so "Open original" keeps
 * `role="link"` for `target="_blank"`), styled to match `Button`'s
 * `secondary`/`sm` exactly: same height (44px below `sm`, 40px from `sm`),
 * padding, radius, border, `font-medium` weight and icon gap. */
const LINK_BUTTON_CLASSES =
  'inline-flex h-11 flex-shrink-0 items-center justify-center gap-2 rounded-control border border-border ' +
  'bg-white px-3 text-sm font-medium text-ink hover:bg-slate-50 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ' +
  'transition-colors duration-150 motion-reduce:transition-none sm:h-10 sm:px-3.5'

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

function RotateIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
      <path
        d="M15.5 9.5a5.5 5.5 0 11-1.6-3.9M15.5 3v3.5H12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function DownloadIcon() {
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
  /** Only for `?view=styleguide`'s static samples (an inline image instead
   * of a real saved file); the app never passes it, so the viewer always
   * loads `GET /receipts/{id}/file` there. */
  fileUrl?: string
}

type Rotation = 0 | 90 | 180 | 270

interface NaturalSize {
  width: number
  height: number
}

/** How the image is drawn for a given zoom/rotation. 0° and 180° keep the
 * plain `<img style="width: zoom%">` (180° only adds a transform -- the
 * layout box is the same). 90°/270° need the layout to follow the rotation,
 * which a CSS transform alone never does: a wrapper takes the rotated
 * image's place (`width: zoom%` of the panel, `aspect-ratio` = natural
 * height / natural width, i.e. the rotated shape), and the image inside is
 * absolutely centered, sized so that its *height* equals the wrapper's
 * width (`width: (naturalWidth / naturalHeight) * 100%` of the wrapper),
 * then rotated. So "Fit" (100%) fits the rotated image to the panel's
 * width, exactly as it does for an unrotated one. Before the image has
 * loaded its natural size is unknown, so there is no wrapper yet and the
 * transform is applied alone. */
function imageLayout(
  zoom: number,
  rotation: Rotation,
  natural: NaturalSize | null,
  isLoaded: boolean,
): { wrapperStyle: CSSProperties | null; imageStyle: CSSProperties } {
  const display = isLoaded ? 'block' : 'none'
  const sideways = rotation === 90 || rotation === 270

  if (sideways && natural && natural.width > 0 && natural.height > 0) {
    return {
      wrapperStyle: {
        position: 'relative',
        width: `${zoom}%`,
        aspectRatio: `${natural.height} / ${natural.width}`,
        flexShrink: 0,
        display,
      },
      imageStyle: {
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: `${(natural.width / natural.height) * 100}%`,
        maxWidth: 'none',
        transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
        display: 'block',
      },
    }
  }

  return {
    wrapperStyle: null,
    imageStyle: {
      width: `${zoom}%`,
      display,
      ...(rotation === 0 ? {} : { transform: `rotate(${rotation}deg)` }),
    },
  }
}

function ReceiptFileViewer({ receiptId, fileName, contentType, fileUrl: fileUrlOverride }: ReceiptFileViewerProps) {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)
  // Rotation is view-only (never saved or sent anywhere) and belongs to one
  // receipt: it's stored together with the receipt id it was set for, so
  // the moment another receipt loads into this same mounted viewer (e.g.
  // Previous/Next in review mode, which never remounts it) it reads as 0
  // again -- no effect needed.
  const [rotationState, setRotationState] = useState<{ receiptId: string; rotation: Rotation }>({
    receiptId,
    rotation: 0,
  })
  const rotation: Rotation = rotationState.receiptId === receiptId ? rotationState.rotation : 0
  const [natural, setNatural] = useState<NaturalSize | null>(null)

  const fileUrl = fileUrlOverride ?? receiptFileUrl(receiptId)
  const archiveUrl = receiptArchiveUrl(receiptId)
  const kind = decideKind(contentType, fileName)

  const zoomIn = () => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))
  const zoomOut = () => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))
  const fit = () => setZoom(DEFAULT_ZOOM)
  const rotate = () =>
    setRotationState({ receiptId, rotation: (((rotation + 90) % 360) as Rotation) })

  const imageAlt = fileName ? `Original receipt image (${fileName})` : 'Original receipt image'
  const layout = imageLayout(zoom, rotation, natural, isLoaded)
  const image = (
    <img
      src={fileUrl}
      alt={imageAlt}
      style={layout.imageStyle}
      className="mx-auto"
      onLoad={(e) => {
        setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })
        setIsLoaded(true)
      }}
      onError={() => setHasError(true)}
    />
  )

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-md ${
        kind === 'pdf' ? 'lg:h-[calc(100vh-6rem)]' : 'lg:max-h-[calc(100vh-6rem)]'
      }`}
    >
      {/* Two rows. Row 1: the file name (takes the free space, truncated)
          and the two links. Row 2, images only: the view controls as one
          group. Every row wraps left-aligned (no justify-end/between), so a
          narrow panel never shows a leading gap or clips a control: the
          links drop under the name, and the view controls wrap among
          themselves. */}
      <div className="flex flex-col gap-2 border-b border-border px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          {fileName ? (
            <p className="min-w-0 flex-1 basis-40 truncate text-sm font-medium text-ink" title={fileName}>
              {fileName}
            </p>
          ) : (
            <span className="flex-1" />
          )}

          {!hasError && (
            <div className="flex flex-wrap items-center gap-2">
              <a href={fileUrl} target="_blank" rel="noopener noreferrer" className={LINK_BUTTON_CLASSES}>
                <ExternalLinkIcon />
                Open original
              </a>
              {/* A plain <a href> -- the server's Content-Disposition:
                  attachment header triggers the browser's download directly,
                  so no fetch (and therefore no CORS) is needed here. */}
              <a href={archiveUrl} className={LINK_BUTTON_CLASSES}>
                <DownloadIcon />
                Download PDF
              </a>
            </div>
          )}
        </div>

        {kind === 'image' && !hasError && (
          <div className="flex flex-wrap items-center gap-1">
            <Button
              variant="secondary"
              size="sm"
              aria-label="Zoom out"
              onClick={zoomOut}
              disabled={zoom <= MIN_ZOOM}
            >
              <ZoomOutIcon />
            </Button>
            <span className="min-w-[3rem] text-center text-sm tabular-nums text-ink-muted">{zoom}%</span>
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
            <Button variant="secondary" size="sm" aria-label="Rotate 90 degrees clockwise" onClick={rotate}>
              <RotateIcon />
              Rotate
            </Button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-slate-100">
        {hasError ? (
          <div className="p-4">
            <Alert variant="info">{NOT_AVAILABLE_MESSAGE}</Alert>
          </div>
        ) : kind === 'pdf' ? (
          <iframe
            src={`${fileUrl}${PDF_VIEW_FRAGMENT}`}
            title={fileName ? `Original receipt PDF (${fileName})` : 'Original receipt PDF'}
            className="h-[600px] w-full lg:h-full"
          />
        ) : (
          <div className="flex min-h-[200px] items-center justify-center p-4">
            {!isLoaded && <p className="text-sm text-ink-muted">Loading image...</p>}
            {layout.wrapperStyle ? (
              <div style={layout.wrapperStyle} className="mx-auto">
                {image}
              </div>
            ) : (
              image
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default ReceiptFileViewer
