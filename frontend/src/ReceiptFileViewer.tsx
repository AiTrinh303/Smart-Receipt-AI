import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { receiptArchiveUrl } from './api/receiptArchiveUrl'
import { receiptFileUrl } from './api/receiptFileUrl'
import Alert from './components/ui/Alert'
import Button from './components/ui/Button'
import { useMediaQuery } from './hooks/useMediaQuery'

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

interface AreaSize {
  width: number
  height: number
}

/** A pixel length rounded to 2 decimals (avoids "399.9999999999999px"). */
function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`
}

/** The image area's inner padding (`p-4`), on each side. */
const AREA_PADDING_PX = 16

/** How the image is drawn for a given zoom/rotation.
 *
 * Measured mode (the image has loaded and the image area has a size): zoom
 * is relative to a *fitted* size. The fitted scale makes the (rotated)
 * image fit the area's width -- and, from `lg` up where the viewer has a
 * fixed height, its height too, so the whole receipt is visible ("contain").
 * A box of the rotated image's exact pixel size takes its place in the
 * layout; the `<img>` inside is absolutely centered at its unrotated pixel
 * size and rotated, since a CSS transform alone never changes layout.
 *
 * Fallback mode (no natural size or no measured area yet -- e.g. jsdom, or
 * the instant before measuring): the earlier percentage layout, `width:
 * zoom%` of the area, with a wrapper for 90°/270°.
 *
 * Both modes set `max-width: none` on the `<img>`: Tailwind's base styles
 * give every `<img>` `max-width: 100%`, which silently capped any zoom
 * above 100% at the panel width -- the zoom bug this fixes. */
function imageLayout(
  zoom: number,
  rotation: Rotation,
  natural: NaturalSize | null,
  isLoaded: boolean,
  area: AreaSize | null,
  fitHeightToo: boolean,
): { wrapperStyle: CSSProperties | null; imageStyle: CSSProperties } {
  const display = isLoaded ? 'block' : 'none'
  const sideways = rotation === 90 || rotation === 270
  const hasNatural = natural !== null && natural.width > 0 && natural.height > 0

  const availableWidth = area ? area.width - 2 * AREA_PADDING_PX : 0
  const availableHeight = area ? area.height - 2 * AREA_PADDING_PX : 0
  const canMeasure = hasNatural && availableWidth > 0 && (!fitHeightToo || availableHeight > 0)

  if (canMeasure && natural) {
    // The rotated image's bounding box, at natural size.
    const boxNaturalWidth = sideways ? natural.height : natural.width
    const boxNaturalHeight = sideways ? natural.width : natural.height
    const fitScale = fitHeightToo
      ? Math.min(availableWidth / boxNaturalWidth, availableHeight / boxNaturalHeight)
      : availableWidth / boxNaturalWidth
    const scale = (fitScale * zoom) / 100

    return {
      wrapperStyle: {
        position: 'relative',
        width: px(boxNaturalWidth * scale),
        height: px(boxNaturalHeight * scale),
        flexShrink: 0,
        margin: 'auto',
        display,
      },
      imageStyle: {
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: px(natural.width * scale),
        height: px(natural.height * scale),
        maxWidth: 'none',
        transform: `translate(-50%, -50%)${rotation === 0 ? '' : ` rotate(${rotation}deg)`}`,
        display: 'block',
      },
    }
  }

  if (sideways && hasNatural && natural) {
    return {
      wrapperStyle: {
        position: 'relative',
        width: `${zoom}%`,
        aspectRatio: `${natural.height} / ${natural.width}`,
        flexShrink: 0,
        margin: 'auto',
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
      maxWidth: 'none',
      flexShrink: 0,
      margin: 'auto',
      display,
      ...(rotation === 0 ? {} : { transform: `rotate(${rotation}deg)` }),
    },
  }
}

/** The image area's inner size, kept up to date with a ResizeObserver
 * (falling back to window resizes where it doesn't exist, e.g. jsdom). */
function useElementSize(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<AreaSize | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!enabled || !element) {
      return
    }
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    if (typeof ResizeObserver === 'undefined') {
      const frame = window.requestAnimationFrame(measure)
      window.addEventListener('resize', measure)
      return () => {
        window.cancelAnimationFrame(frame)
        window.removeEventListener('resize', measure)
      }
    }
    // The observer reports the initial size on its own right after observe().
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [enabled])

  return { ref, size }
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
  const isWide = useMediaQuery('(min-width: 1024px)')

  const fileUrl = fileUrlOverride ?? receiptFileUrl(receiptId)
  const archiveUrl = receiptArchiveUrl(receiptId)
  const kind = decideKind(contentType, fileName)
  const { ref: areaRef, size: areaSize } = useElementSize(kind === 'image' && !hasError)

  const zoomIn = () => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))
  const zoomOut = () => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))
  const fit = () => setZoom(DEFAULT_ZOOM)
  const rotate = () =>
    setRotationState({ receiptId, rotation: (((rotation + 90) % 360) as Rotation) })

  const imageAlt = fileName ? `Original receipt image (${fileName})` : 'Original receipt image'
  // From `lg` up the viewer has a fixed height, so "fit" means the whole
  // image fits (width and height); below `lg` it fits the width, as before.
  const layout = imageLayout(zoom, rotation, natural, isLoaded, areaSize, isWide)
  const image = (
    <img
      src={fileUrl}
      alt={imageAlt}
      style={layout.imageStyle}
      onLoad={(e) => {
        setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })
        setIsLoaded(true)
      }}
      onError={() => setHasError(true)}
    />
  )

  const showViewControls = kind === 'image' && !hasError

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-md lg:h-[calc(100vh-6rem)]">
      {/* One row: the view controls (images only) on the left, the two links
          on the right. `justify-between` puts a lone item at the start of
          its line, so when the row wraps, the links' line starts at the
          left edge too -- no leading gap. A PDF has no view controls; an
          empty spacer keeps its links on the right. After a failed load
          there is nothing to show, so the row is left out. */}
      {!hasError && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
          {showViewControls ? (
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
          ) : (
            <span aria-hidden="true" />
          )}

          <div className="flex flex-wrap items-center gap-2">
            {/* The file name is no longer shown as text; it stays available
                as this link's tooltip and in the image's alt text. */}
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={fileName ?? undefined}
              className={LINK_BUTTON_CLASSES}
            >
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
        </div>
      )}

      <div
        ref={areaRef}
        className={`min-h-0 flex-1 overflow-auto ${kind === 'image' ? 'bg-slate-100 lg:bg-surface-page' : 'bg-slate-100'}`}
      >
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
          // `m-auto` on the image (not justify/items-center on this flex
          // box) centers it while it fits, and collapses to 0 once it is
          // larger than the area -- so a zoomed image can be scrolled to
          // every edge, left and top included.
          <div className="flex min-h-[200px] min-w-full p-4 lg:min-h-full">
            {!isLoaded && <p className="m-auto text-sm text-ink-muted">Loading image...</p>}
            {layout.wrapperStyle ? <div style={layout.wrapperStyle}>{image}</div> : image}
          </div>
        )}
      </div>
    </div>
  )
}

export default ReceiptFileViewer
