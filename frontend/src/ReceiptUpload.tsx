import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError } from './api/ApiError'
import { deleteReceipt } from './api/deleteReceipt'
import { extractReceipt } from './api/extractReceipt'
import { getReceipt } from './api/getReceipt'
import type { SavedReceipt } from './api/getReceipt'
import { listReceipts } from './api/listReceipts'
import { resetReceipt } from './api/resetReceipt'
import { uploadReceipt } from './api/uploadReceipt'
import type { ReceiptExtraction, ReceiptStatus, ReceiptSummary } from './api/types'
import {
  EXTRACTION_FAILED_MESSAGE,
  EXTRACTION_NOT_CONFIGURED_MESSAGE,
  NETWORK_ERROR_MESSAGE,
} from './errorMessages'
import { IMAGE_EXTENSIONS, getExtension, isLikelyValidPdf, isValidFile } from './fileValidation'
import { navigateTo } from './navigation'
import { apartmentPlace } from './format/apartmentPlace'
import { apartmentShortName } from './format/apartmentShortName'
import { useApartments } from './hooks/useApartments'
import { useMediaQuery } from './hooks/useMediaQuery'
import BatchQueue from './batch/BatchQueue'
import { useBatchUpload } from './batch/useBatchUpload'
import ReceiptApartment from './ReceiptApartment'
import ReceiptDetailLayout from './ReceiptDetailLayout'
import ReceiptEditForm from './ReceiptEditForm'
import ReceiptResult from './ReceiptResult'
import ReviewBar from './ReviewBar'
import type { ReviewNavigation } from './ReviewBar'
import { effectiveStatus, effectiveYear } from './ReceiptFilters'
import { useBottomBarVariant } from './hooks/useBottomBarVariant'
import Alert from './components/ui/Alert'
import Button from './components/ui/Button'
import Card from './components/ui/Card'
import PageHeader from './components/ui/PageHeader'
import RadioCardGroup from './components/ui/RadioCardGroup'
import Skeleton from './components/ui/Skeleton'
import Spinner from './components/ui/Spinner'
import { formatFileSize } from './components/ui/formatFileSize'

const RECEIPT_QUERY_PARAM = 'receipt'
const HISTORY_RETURN_PARAM = 'from'
const APARTMENT_HELPER_ID = 'apartment-helper'
const FILE_HELPER_ID = 'file-helper'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UPLOAD_DESCRIPTION = 'Read the date, store, items and total automatically.'

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}

// Files often arrive in browser/OS enumeration order (e.g. newest-first by
// date), which reads as random next to a camera's sequential filenames. A
// natural-compare sort by name (numeric runs compared as numbers, so
// "img2.jpg" sorts before "img10.jpg") gives a predictable, intuitive order
// regardless of how the picker/drop handed the files over.
const NATURAL_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function sortFilesByName(files: File[]): File[] {
  return [...files].sort((a, b) => NATURAL_COLLATOR.compare(a.name, b.name))
}

function getReceiptIdFromUrl(): { id: string | null; invalid: boolean } {
  const params = new URLSearchParams(window.location.search)
  const raw = params.get(RECEIPT_QUERY_PARAM)
  if (raw === null) {
    return { id: null, invalid: false }
  }
  return isValidUuid(raw) ? { id: raw, invalid: false } : { id: null, invalid: true }
}

function setReceiptIdInUrl(id: string) {
  const params = new URLSearchParams(window.location.search)
  params.set(RECEIPT_QUERY_PARAM, id)
  const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`
  window.history.replaceState({}, '', newUrl)
}

function removeReceiptIdFromUrl() {
  const params = new URLSearchParams(window.location.search)
  params.delete(RECEIPT_QUERY_PARAM)
  params.delete(HISTORY_RETURN_PARAM)
  const query = params.toString()
  const newUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
  window.history.replaceState({}, '', newUrl)
}

/** Reads the `from` param a filtered history or items list attaches when
 * opening a receipt, so the back link can return to the same tab/filters
 * (and, for items, the same search) instead of always resetting to the
 * unfiltered history list. Only ever trusts a value that actually points
 * back at one of those two views. */
function getBackNavigation(): { search: string; label: string } {
  const params = new URLSearchParams(window.location.search)
  const from = params.get(HISTORY_RETURN_PARAM)
  if (from && from.startsWith('?view=items')) {
    return { search: from, label: 'Back to items' }
  }
  if (from && from.startsWith('?view=history')) {
    return { search: from, label: 'Back to history' }
  }
  return { search: '?view=history', label: 'Back to history' }
}

/** Review mode (position/Previous/Next/"Approve and next") is only ever
 * offered when this receipt was opened from a filtered/tabbed *history*
 * list -- never when `from` is missing or points at the items view, which
 * the caller is expected to simply not request a snapshot for. */
function getHistoryFromParam(): string | null {
  const params = new URLSearchParams(window.location.search)
  const from = params.get(HISTORY_RETURN_PARAM)
  return from && from.startsWith('?view=history') ? from : null
}

/** Parses the apartment/year/status filters out of a `from` value produced
 * by ReceiptHistory.tsx (e.g. "?view=history&apartment=<id>&status=needs_
 * review"), using the exact same effectiveYear/effectiveStatus rules that
 * page already validates its own URL params with, so a malformed value
 * here is dropped exactly as it would be there -- never sent as-is. */
function parseHistoryFilters(fromSearch: string): { apartmentId?: string; year?: string; status?: ReceiptStatus } {
  const params = new URLSearchParams(fromSearch.slice(fromSearch.indexOf('?') + 1))
  const apartmentId = params.get('apartment') ?? undefined
  const year = effectiveYear(params.get('year')) ?? undefined
  const status = effectiveStatus(params.get('status')) ?? undefined
  return { apartmentId, year, status }
}

const REVIEW_SNAPSHOT_LIMIT = 200

interface UploadSuccess {
  receiptId: string
  filename: string
}

const LOAD_RECEIPT_FAILED_MESSAGE = 'Could not load this receipt. Please try again.'
const STOPPED_MESSAGE = 'Stopped. The remaining receipts were not processed.'

// The extract endpoint's response (ReceiptExtraction) never includes the
// original filename/content type -- only GET /receipts/{id} does. These
// stay optional so `result` can hold either response shape without
// widening the backend contract.
type ReceiptResultData = ReceiptExtraction & {
  original_filename?: string | null
  content_type?: string | null
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
      <path
        d="M4 6h12M8 6V4.5A1.5 1.5 0 019.5 3h1A1.5 1.5 0 0112 4.5V6m-6.5 0l.6 9.4a1.5 1.5 0 001.5 1.6h3.8a1.5 1.5 0 001.5-1.6l.6-9.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const TIPS_ITEMS = [
  'Lay the receipt flat.',
  'Use good light.',
  'Keep the whole receipt in frame, including the total.',
  'One receipt per photo.',
]

const HOW_IT_WORKS_STEPS = [
  'Choose the apartment.',
  'Add photos or PDFs.',
  'Review the result and approve it in History or Items.',
]

/** A numbered section heading inside the upload form card -- the number is
 * a decorative badge (`aria-hidden`), so the heading's own accessible name
 * is just the word (e.g. "Apartment"), never "1 Apartment". `required`
 * adds a small text tag (never color alone) marking that section as
 * required to proceed. */
function SectionHeading({
  number,
  required = false,
  children,
}: {
  number: number
  required?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white"
      >
        {number}
      </span>
      <h2 className="text-base font-semibold text-ink">{children}</h2>
      {required && (
        <span className="rounded-full border border-border-subtle px-2 py-0.5 text-xs font-medium text-ink-muted">
          Required
        </span>
      )}
    </div>
  )
}

function ChevronIcon({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={className} fill="none">
      <path d="M7.5 4.5l5 5.5-5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Collapsible reading tips, shown below `lg` (where the static HelpPanel
 * isn't rendered) -- a plain <details>/<summary> styled as a text-style
 * control rather than a bordered box, with a chevron that rotates open. */
function TipsDetails() {
  return (
    <details className="group text-sm text-ink-muted">
      <summary className="flex cursor-pointer select-none list-none items-center gap-1.5 font-medium text-ink [&::-webkit-details-marker]:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
        <ChevronIcon className="h-4 w-4 flex-shrink-0 text-ink-muted transition-transform duration-150 motion-reduce:transition-none group-open:rotate-90" />
        Tips for better reading
      </summary>
      <ul className="mt-2 flex flex-col gap-1 pl-6 list-disc">
        {TIPS_ITEMS.map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>
    </details>
  )
}

/** Static "How it works" + reading tips, shown instead of the collapsible
 * tips from `lg` up -- no fetch, no state, just reference content next to
 * the form. Uses the standard `Card` elevation (never a stronger one --
 * a panel sitting flush next to the form card should read as its equal,
 * not as a popup floating above it) and, from `lg` up, stays in view via
 * `sticky` while the (usually taller) form scrolls past it; `top-20`
 * (80px) clears the shell's `h-16` (64px) header with 16px to spare. */
function HelpPanel() {
  return (
    <Card className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
      <h2 className="text-base font-semibold text-ink">How it works</h2>
      <ol className="flex flex-col gap-3">
        {HOW_IT_WORKS_STEPS.map((step, index) => (
          <li key={step} className="flex gap-3">
            <span
              aria-hidden="true"
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand-subtle text-xs font-semibold text-brand"
            >
              {index + 1}
            </span>
            <p className="text-sm text-ink-muted">{step}</p>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-2 border-t border-border-subtle pt-4">
        <h3 className="text-sm font-semibold text-ink">Tips for better reading</h3>
        <ul className="flex flex-col gap-1 pl-5 list-disc text-sm text-ink-muted">
          {TIPS_ITEMS.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      </div>
    </Card>
  )
}

function ReceiptUpload() {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<UploadSuccess | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [apartmentId, setApartmentId] = useState<string | null>(null)

  const [receiptId, setReceiptId] = useState<string | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [extractionError, setExtractionError] = useState<string | null>(null)
  const [result, setResult] = useState<ReceiptResultData | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isConfirmingReset, setIsConfirmingReset] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  const initialReceipt = getReceiptIdFromUrl()
  const [isLoadingReceipt, setIsLoadingReceipt] = useState(initialReceipt.id !== null)
  const [notFound, setNotFound] = useState(initialReceipt.invalid)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Review mode: the `from` value is read once, at mount -- intra-review
  // navigation (Previous/Next/Approve and next) updates the address bar
  // via replaceState (see setReceiptIdInUrl) without remounting this
  // component, so it never changes mid-session. The snapshot itself stays
  // `null` (showing no review controls at all, same as today's behaviour)
  // whenever `from` is missing/points at the items view, or the request
  // fails -- a failure is never surfaced as an Alert, since the receipt
  // itself must still work without it.
  const [reviewFromSearch] = useState(getHistoryFromParam)
  const [reviewSnapshot, setReviewSnapshot] = useState<ReceiptSummary[] | null>(null)

  useEffect(() => {
    if (!reviewFromSearch) {
      return
    }
    let cancelled = false

    async function loadSnapshot() {
      try {
        const { apartmentId, year, status } = parseHistoryFilters(reviewFromSearch as string)
        const response = await listReceipts({ apartmentId, year, status, limit: REVIEW_SNAPSHOT_LIMIT })
        if (!cancelled) {
          setReviewSnapshot(response.items)
        }
      } catch {
        // Silently hidden -- see the comment above.
      }
    }

    loadSnapshot()
    return () => {
      cancelled = true
    }
    // Only ever run once, on mount (reviewFromSearch is itself fixed for
    // the lifetime of this mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The apartment list is only needed for the plain upload form -- never
  // while reopening, showing, or failing to load a saved receipt by id.
  const showingUploadForm = !result && !isLoadingReceipt && !notFound && !loadError
  const {
    apartments,
    isLoading: isLoadingApartments,
    error: apartmentsError,
    retry: retryApartments,
  } = useApartments(showingUploadForm)

  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  // The static help panel (from `lg` up) and the collapsible tips (below
  // `lg`) show the same tips content -- only one is ever rendered, decided
  // here, never by CSS alone, so the text can never appear twice in the
  // DOM. `useMediaQuery` defaults to `false` when `matchMedia` doesn't
  // exist (jsdom's default), which is exactly the below-`lg` variant.
  const isWideScreen = useMediaQuery('(min-width: 1024px)')
  const useBottomReviewBar = useBottomBarVariant()

  const batch = useBatchUpload()
  const isBatchActive = batch.items.length > 0
  const batchInFlight = batch.items.some((item) => item.status === 'uploading' || item.status === 'reading')
  const batchWaitingOrInFlight = batch.items.some(
    (item) => item.status === 'waiting' || item.status === 'uploading' || item.status === 'reading',
  )
  const isBatchFinished = isBatchActive && !batchWaitingOrInFlight
  const batchDoneCount = batch.items.filter((item) => item.status === 'done').length
  const batchFailedCount = batch.items.filter((item) => item.status === 'failed').length

  // "N receipts · X MB · for <short apartment name>" -- shown before start,
  // replaced by the <progress>/"N of M read, K failed" text once running
  // (which also covers paused and finished, since `running` is never reset
  // back to false by STOP or finishing).
  const batchTotalBytes = batch.items.reduce((sum, item) => sum + item.file.size, 0)
  const batchSelectedApartment = apartments?.find((a) => a.id === apartmentId) ?? null
  const batchApartmentLabel = batchSelectedApartment
    ? (apartmentShortName(batchSelectedApartment.name) ?? batchSelectedApartment.name)
    : null
  const batchSummaryText = batchApartmentLabel
    ? `${batch.items.length} receipts · ${formatFileSize(batchTotalBytes)} · for ${batchApartmentLabel}`
    : `${batch.items.length} receipts · ${formatFileSize(batchTotalBytes)}`

  // Warn before leaving the page while a batch upload/extract call is
  // actually in flight -- closing the tab then would lose that receipt.
  useEffect(() => {
    if (!batchInFlight) {
      return
    }
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [batchInFlight])

  const [previewUrl, setPreviewUrlState] = useState<string | null>(null)
  const previewUrlRef = useRef<string | null>(null)

  // Always revokes the previous object URL (if any) before adopting the
  // next one, so there is at most one live object URL for the selected
  // file at any time -- the only way to avoid leaking them. A ref (not
  // just the state) is used so the unmount cleanup below always sees the
  // latest URL rather than a stale closure.
  const setPreviewUrl = (next: string | null) => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
    }
    previewUrlRef.current = next
    setPreviewUrlState(next)
  }

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
      }
    }
  }, [])

  const loadSavedReceipt = async (id: string) => {
    setIsLoadingReceipt(true)
    setLoadError(null)
    setNotFound(false)
    setReceiptId(id)

    try {
      const data = await getReceipt(id)
      setResult(data)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true)
      } else if (err instanceof ApiError) {
        setLoadError(LOAD_RECEIPT_FAILED_MESSAGE)
      } else {
        setLoadError(NETWORK_ERROR_MESSAGE)
      }
    } finally {
      setIsLoadingReceipt(false)
    }
  }

  useEffect(() => {
    if (initialReceipt.id) {
      loadSavedReceipt(initialReceipt.id)
    }
    // Only ever run once, on mount, to read the URL's initial state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Moves within the review snapshot (Previous/Next, and after a
  // successful "Approve and next") without remounting this component --
  // setReceiptIdInUrl only ever touches the `receipt` param via
  // replaceState, leaving `from` (and therefore reviewFromSearch and the
  // snapshot fetched from it) untouched, so the snapshot is truly
  // fetched only once per review session, never refetched on every move.
  const navigateToReceiptInSnapshot = (id: string) => {
    setReceiptIdInUrl(id)
    loadSavedReceipt(id)
  }

  const handleReviewUpdated = (updated: SavedReceipt) => {
    setResult(updated)
    setReviewSnapshot((prev) =>
      prev ? prev.map((item) => (item.receipt_id === updated.receipt_id ? { ...item, status: updated.status } : item)) : prev,
    )
  }

  const handleApprovedAndNext = (updated: SavedReceipt) => {
    if (!reviewSnapshot || !reviewFromSearch) {
      return
    }
    const currentIndex = reviewSnapshot.findIndex((item) => item.receipt_id === updated.receipt_id)
    const nextNeedsReview = reviewSnapshot
      .slice(currentIndex + 1)
      .find((item) => item.status === 'needs_review')

    if (nextNeedsReview) {
      navigateToReceiptInSnapshot(nextNeedsReview.receipt_id)
    } else {
      navigateTo(`${reviewFromSearch}&notice=reviewed`)
    }
  }

  const runExtraction = async (id: string) => {
    setIsExtracting(true)
    setExtractionError(null)

    try {
      const data = await extractReceipt(id)
      setResult(data)
      setReceiptIdInUrl(id)
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setExtractionError(EXTRACTION_NOT_CONFIGURED_MESSAGE)
      } else if (err instanceof ApiError) {
        setExtractionError(EXTRACTION_FAILED_MESSAGE)
      } else {
        setExtractionError(NETWORK_ERROR_MESSAGE)
      }
    } finally {
      setIsExtracting(false)
    }
  }

  const processFile = async (selected: File) => {
    if (isBatchActive) {
      batch.reset()
    }
    setSuccess(null)
    setResult(null)
    setIsEditing(false)
    setExtractionError(null)
    setReceiptId(null)

    if (!isValidFile(selected)) {
      setFile(null)
      setPreviewUrl(null)
      setError('Invalid file type. Please select a JPG, PNG, or PDF file.')
      return
    }

    const extension = getExtension(selected.name)

    if (extension === '.pdf' && !(await isLikelyValidPdf(selected))) {
      setFile(null)
      setPreviewUrl(null)
      setError('This file does not look like a valid PDF.')
      return
    }

    setFile(selected)
    setPreviewUrl(IMAGE_EXTENSIONS.includes(extension) ? URL.createObjectURL(selected) : null)
    setError(null)
  }

  const handleBatchFilesSelected = async (files: File[]) => {
    // Switching to batch mode replaces whatever single-file selection/result
    // was showing -- the batch panel takes over below the dropzone.
    setFile(null)
    setPreviewUrl(null)
    setError(null)
    setSuccess(null)
    setResult(null)
    setIsEditing(false)
    setExtractionError(null)
    setReceiptId(null)
    await batch.addFiles(sortFilesByName(files))
  }

  const handleBatchReset = () => {
    batch.reset()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files ? Array.from(e.target.files) : []
    e.target.value = ''
    if (selectedFiles.length === 0 || batch.running) {
      return
    }
    if (selectedFiles.length === 1) {
      await processFile(selectedFiles[0])
      return
    }
    await handleBatchFilesSelected(selectedFiles)
  }

  const handleRemoveFile = () => {
    setFile(null)
    setPreviewUrl(null)
    setError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    if (cameraInputRef.current) {
      cameraInputRef.current.value = ''
    }
  }

  const openFilePicker = () => {
    if (!(isUploading || isExtracting || batch.running)) {
      fileInputRef.current?.click()
    }
  }

  const handleZoneKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openFilePicker()
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = () => {
    setIsDragOver(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)

    if (batch.running) {
      return
    }

    const droppedFiles = Array.from(e.dataTransfer.files)
    if (droppedFiles.length === 0) {
      return
    }
    if (droppedFiles.length === 1) {
      await processFile(droppedFiles[0])
      return
    }
    await handleBatchFilesSelected(droppedFiles)
  }

  const handleSubmit = async () => {
    if (!file) {
      setError('Please select a file before submitting.')
      return
    }
    if (!apartmentId) {
      return
    }

    setIsUploading(true)
    setError(null)
    setSuccess(null)
    setResult(null)
    setIsEditing(false)
    setExtractionError(null)

    try {
      const uploadResult = await uploadReceipt(file, apartmentId)
      setSuccess({ receiptId: uploadResult.receipt_id, filename: uploadResult.filename })
      setReceiptId(uploadResult.receipt_id)
      setIsUploading(false)
      await runExtraction(uploadResult.receipt_id)
    } catch (err) {
      setIsUploading(false)
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError(NETWORK_ERROR_MESSAGE)
      }
    }
  }

  const handleRetryExtraction = () => {
    if (receiptId) {
      runExtraction(receiptId)
    }
  }

  const handleRetryLoad = () => {
    if (receiptId) {
      loadSavedReceipt(receiptId)
    }
  }

  const handleConfirmDelete = async () => {
    if (!result) {
      return
    }

    setIsDeleting(true)
    setDeleteError(null)

    try {
      await deleteReceipt(result.receipt_id)
      navigateTo('?view=history&notice=deleted')
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        navigateTo('?view=history&notice=gone')
      } else if (err instanceof ApiError) {
        setDeleteError(err.message)
      } else {
        setDeleteError(NETWORK_ERROR_MESSAGE)
      }
    } finally {
      setIsDeleting(false)
    }
  }

  const handleConfirmReset = async () => {
    if (!result) {
      return
    }

    setIsResetting(true)
    setResetError(null)

    try {
      const updated = await resetReceipt(result.receipt_id)
      setResult(updated)
      setIsConfirmingReset(false)
    } catch (err) {
      if (err instanceof ApiError) {
        setResetError(err.message)
      } else {
        setResetError(NETWORK_ERROR_MESSAGE)
      }
    } finally {
      setIsResetting(false)
    }
  }

  const handleReset = () => {
    setFile(null)
    setPreviewUrl(null)
    setError(null)
    setSuccess(null)
    setIsUploading(false)
    setReceiptId(null)
    setIsExtracting(false)
    setExtractionError(null)
    setResult(null)
    setIsEditing(false)
    setIsConfirmingDelete(false)
    setIsDeleting(false)
    setDeleteError(null)
    setIsConfirmingReset(false)
    setIsResetting(false)
    setResetError(null)
    setIsLoadingReceipt(false)
    setNotFound(false)
    setLoadError(null)
    removeReceiptIdFromUrl()
  }

  const resultFileName = result?.original_filename ?? file?.name ?? success?.filename ?? null
  const resultContentType = result?.content_type ?? null

  if (result && isEditing) {
    return (
      <ReceiptDetailLayout receiptId={result.receipt_id} fileName={resultFileName} contentType={resultContentType}>
        <ReceiptEditForm
          receiptId={result.receipt_id}
          data={result}
          onSave={(updated) => {
            setResult(updated)
            setIsEditing(false)
          }}
          onCancel={() => setIsEditing(false)}
        />
      </ReceiptDetailLayout>
    )
  }

  if (result) {
    const backNavigation = getBackNavigation()

    const snapshotIndex = reviewSnapshot?.findIndex((item) => item.receipt_id === result.receipt_id) ?? -1
    const reviewNavigation: ReviewNavigation | undefined =
      reviewSnapshot && reviewFromSearch && snapshotIndex !== -1
        ? {
            position: { index: snapshotIndex, total: reviewSnapshot.length },
            previous:
              snapshotIndex > 0
                ? {
                    id: reviewSnapshot[snapshotIndex - 1].receipt_id,
                    href: `/?receipt=${reviewSnapshot[snapshotIndex - 1].receipt_id}&from=${encodeURIComponent(reviewFromSearch)}`,
                  }
                : null,
            next:
              snapshotIndex < reviewSnapshot.length - 1
                ? {
                    id: reviewSnapshot[snapshotIndex + 1].receipt_id,
                    href: `/?receipt=${reviewSnapshot[snapshotIndex + 1].receipt_id}&from=${encodeURIComponent(reviewFromSearch)}`,
                  }
                : null,
            onNavigate: navigateToReceiptInSnapshot,
            onApprovedAndNext: handleApprovedAndNext,
          }
        : undefined

    return (
      <div className={`flex flex-col gap-4 ${useBottomReviewBar ? 'pb-24' : ''}`}>
        {!isConfirmingDelete && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <a
              href={`/${backNavigation.search}`}
              onClick={(e) => {
                e.preventDefault()
                navigateTo(backNavigation.search)
              }}
              className="inline-flex w-fit items-center gap-1.5 rounded-md px-1 py-2 text-sm font-medium text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
                <path
                  d="M12 15l-5-5 5-5M7.5 10H17"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {backNavigation.label}
            </a>
            <Button variant="ghost" size="sm" onClick={handleReset}>
              Upload another receipt
            </Button>
          </div>
        )}

        <ReceiptDetailLayout receiptId={result.receipt_id} fileName={resultFileName} contentType={resultContentType}>
          <div className="flex flex-col gap-4">
            <ReviewBar
              receiptId={result.receipt_id}
              status={result.status}
              onUpdated={handleReviewUpdated}
              reviewNavigation={reviewNavigation}
            />
            <ReceiptApartment
              receiptId={result.receipt_id}
              apartmentId={result.apartment_id}
              onUpdated={(updated) => setResult(updated)}
            />
            <ReceiptResult data={result} onEdit={() => setIsEditing(true)} />

            {isConfirmingDelete ? (
              <Alert variant="error">
                <div className="flex flex-col gap-3">
                  <p>
                    Delete this receipt? This removes the saved data and the uploaded file from
                    this app. This cannot be undone.
                  </p>
                  {deleteError && <p className="font-semibold">{deleteError}</p>}
                  <div className="flex gap-2">
                    <Button variant="danger" size="sm" onClick={handleConfirmDelete} loading={isDeleting} loadingText="Deleting...">
                      Yes, delete
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setIsConfirmingDelete(false)}
                      disabled={isDeleting}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </Alert>
            ) : isConfirmingReset ? (
              <Alert variant="warning">
                <div className="flex flex-col gap-3">
                  <p>Replace your edits with the original AI result? This cannot be undone.</p>
                  {resetError && <p className="font-semibold">{resetError}</p>}
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleConfirmReset}
                      loading={isResetting}
                      loadingText="Resetting..."
                    >
                      Yes, reset
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setIsConfirmingReset(false)}
                      disabled={isResetting}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </Alert>
            ) : (
              <div className="flex items-center justify-between border-t border-border pt-3">
                {result.edited ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setResetError(null)
                      setIsConfirmingReset(true)
                    }}
                  >
                    Reset to AI result
                  </Button>
                ) : (
                  <span />
                )}
                <Button
                  variant="danger-ghost"
                  size="sm"
                  onClick={() => {
                    setDeleteError(null)
                    setIsConfirmingDelete(true)
                  }}
                >
                  <TrashIcon />
                  Delete
                </Button>
              </div>
            )}
          </div>
        </ReceiptDetailLayout>
      </div>
    )
  }

  if (isLoadingReceipt) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-4">
        <span className="sr-only">Loading receipt...</span>
        <div className="grid gap-6 lg:grid-cols-[5fr_6fr]">
          <Skeleton className="h-64 w-full lg:order-1" />
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-6 shadow-md lg:order-2">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </div>
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4 rounded-lg border border-gray-300 p-6">
        <p className="text-sm text-gray-600">Receipt not found</p>
        <button
          type="button"
          onClick={handleReset}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
        >
          Upload a receipt
        </button>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4 rounded-lg border border-gray-300 p-6">
        <p role="alert" className="text-sm text-red-600">
          {loadError}
        </p>
        <button
          type="button"
          onClick={handleRetryLoad}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
        >
          Retry
        </button>
      </div>
    )
  }

  const isBusy = isUploading || isExtracting
  const isInputDisabled = isBusy || batch.running

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader title="Upload receipts" description={UPLOAD_DESCRIPTION} />

      <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
        <div className="flex flex-col gap-4 lg:col-span-7">
          <Card className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <SectionHeading number={1} required>
                Apartment
              </SectionHeading>

              {apartmentsError ? (
                <div className="flex flex-col gap-2">
                  <Alert variant="error">{apartmentsError}</Alert>
                  <Button variant="secondary" size="sm" className="self-start" onClick={retryApartments}>
                    Retry
                  </Button>
                </div>
              ) : isLoadingApartments ? (
                <div role="status" aria-busy="true" className="flex flex-col gap-2">
                  <span className="text-sm text-ink-muted">Loading apartments...</span>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Skeleton className="h-11 flex-1" />
                    <Skeleton className="h-11 flex-1" />
                  </div>
                </div>
              ) : (
                apartments && (
                  <RadioCardGroup
                    legend={
                      isBatchActive
                        ? 'Which apartment are these receipts for?'
                        : 'Which apartment is this receipt for?'
                    }
                    name="apartment"
                    options={apartments.map((apartment) => ({
                      value: apartment.id,
                      label: apartmentShortName(apartment.name) ?? apartment.name,
                      secondaryLabel: apartmentPlace(apartment.name),
                      accessibleName: apartment.name,
                    }))}
                    value={apartmentId}
                    onChange={setApartmentId}
                    disabled={isInputDisabled}
                    describedBy={(file || isBatchActive) && !apartmentId ? APARTMENT_HELPER_ID : undefined}
                    hideLegend
                  />
                )
              )}

              {apartments && (file || isBatchActive) && !apartmentId && (
                <p id={APARTMENT_HELPER_ID} className="text-sm text-ink-muted">
                  Choose an apartment to continue.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-4">
              <SectionHeading number={2}>Receipts</SectionHeading>

              <label htmlFor="receipt-file" className="sr-only">
                Upload receipt (JPG, PNG, or PDF)
              </label>
              <input
                ref={fileInputRef}
                id="receipt-file"
                type="file"
                accept=".jpg,.jpeg,.png,.pdf"
                multiple
                onChange={handleFileChange}
                disabled={isInputDisabled}
                className="sr-only"
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileChange}
                disabled={isInputDisabled}
                aria-hidden="true"
                tabIndex={-1}
                className="sr-only"
              />

              {isBatchActive ? (
                <div
                  role="button"
                  tabIndex={isInputDisabled ? -1 : 0}
                  aria-disabled={isInputDisabled}
                  onClick={openFilePicker}
                  onKeyDown={handleZoneKeyDown}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`flex items-center justify-center gap-2 rounded-control border-2 border-dashed bg-brand-soft p-3 text-center transition-colors duration-150 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                    isInputDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-brand hover:bg-brand-subtle'
                  } ${isDragOver ? 'border-brand bg-brand-subtle' : 'border-border'}`}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 flex-shrink-0 text-brand" fill="none">
                    <path
                      d="M12 16V4m0 0L7 9m5-5l5 5M5 20h14"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <p className="text-sm font-medium text-ink">Add more files</p>
                </div>
              ) : (
                <div
                  role="button"
                  tabIndex={isInputDisabled ? -1 : 0}
                  aria-disabled={isInputDisabled}
                  onClick={openFilePicker}
                  onKeyDown={handleZoneKeyDown}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`flex flex-col items-center gap-2 rounded-control border-2 border-dashed bg-brand-soft p-8 text-center transition-colors duration-150 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                    isInputDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-brand hover:bg-brand-subtle'
                  } ${isDragOver ? 'border-brand bg-brand-subtle' : 'border-border'}`}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-8 w-8 text-brand" fill="none">
                    <path
                      d="M12 16V4m0 0L7 9m5-5l5 5M5 20h14"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <p className="text-sm font-medium text-ink">Drag a receipt here, or</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isInputDisabled}
                    onClick={(e) => {
                      e.stopPropagation()
                      openFilePicker()
                    }}
                  >
                    Browse files
                  </Button>
                  <p className="text-sm text-ink-muted">JPG, PNG or PDF, up to 10 MB</p>
                </div>
              )}

              <Button
                variant="secondary"
                size="sm"
                disabled={isInputDisabled}
                onClick={() => cameraInputRef.current?.click()}
                className="w-full sm:hidden"
              >
                Take photo
              </Button>

              {!isWideScreen && <TipsDetails />}

              {isBatchActive ? (
                <div className="flex flex-col gap-4">
                  <BatchQueue
                    items={batch.items}
                    rejected={batch.rejected}
                    onRetry={batch.retry}
                    onRemove={batch.remove}
                  />

                  <div className="sticky bottom-0 -mx-6 -mb-6 flex flex-col gap-3 border-t border-border bg-surface px-6 pb-6 pt-4">
                    {batch.running ? (
                      <div className="flex flex-col gap-1">
                        <label htmlFor="batch-progress" className="text-sm font-medium text-ink">
                          Batch progress
                        </label>
                        <progress
                          id="batch-progress"
                          value={batchDoneCount + batchFailedCount}
                          max={batch.items.length}
                          className="h-2 w-full accent-brand"
                        />
                        <p role="status" className="text-sm text-ink-muted">
                          {batchDoneCount} of {batch.items.length} read, {batchFailedCount} failed
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-ink-muted">{batchSummaryText}</p>
                    )}

                    {isBatchFinished ? (
                      <>
                        <Alert variant="success">
                          Done: {batchDoneCount} read, {batchFailedCount} failed.
                        </Alert>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => navigateTo(`?view=history&apartment=${apartmentId}&status=needs_review`)}
                          >
                            Review in History
                          </Button>
                          <Button variant="secondary" size="sm" onClick={handleBatchReset}>
                            Read more receipts
                          </Button>
                        </div>
                      </>
                    ) : batch.running ? (
                      batch.pausedReason ? (
                        <>
                          <Alert variant={batch.pausedReason === 'stopped' ? 'warning' : 'error'}>
                            {batch.pausedReason === 'unavailable'
                              ? EXTRACTION_NOT_CONFIGURED_MESSAGE
                              : batch.pausedReason === 'network'
                                ? NETWORK_ERROR_MESSAGE
                                : STOPPED_MESSAGE}
                          </Alert>
                          <Button size="sm" onClick={batch.resume}>
                            Resume
                          </Button>
                        </>
                      ) : (
                        <Button variant="secondary" size="sm" onClick={batch.stop}>
                          Stop
                        </Button>
                      )
                    ) : (
                      <>
                        <Button
                          onClick={() => apartmentId && batch.start(apartmentId)}
                          disabled={!apartmentId || batch.items.length === 0}
                        >
                          Read {batch.items.length} receipts
                        </Button>
                        <p className="flex items-start gap-1.5 text-sm text-ink-muted">
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 20 20"
                            className="mt-0.5 h-4 w-4 flex-shrink-0"
                            fill="none"
                          >
                            <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1.5" />
                            <path
                              d="M10 9v4.5M10 6.75h.01"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                            />
                          </svg>
                          Each receipt is sent to OpenAI to read it ({batch.items.length} requests).
                        </p>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  {file && (
                    <div className="flex items-center gap-3 rounded-control bg-surface-page px-3 py-2">
                      {previewUrl ? (
                        <img
                          src={previewUrl}
                          alt="Preview of the selected receipt"
                          className="h-16 w-16 flex-shrink-0 rounded-md border border-border bg-slate-100 object-contain sm:h-20 sm:w-20"
                        />
                      ) : (
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          className="h-5 w-5 flex-shrink-0 text-ink-muted"
                          fill="none"
                        >
                          <path d="M6 2h8l4 4v16H6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                        </svg>
                      )}
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink" title={file.name}>
                        <span>Selected file: {file.name}</span>{' '}
                        <span className="text-ink-muted">({formatFileSize(file.size)})</span>
                      </p>
                      <Button variant="ghost" size="sm" onClick={handleRemoveFile} disabled={isBusy}>
                        Remove
                      </Button>
                    </div>
                  )}

                  {error && <Alert variant="error">{error}</Alert>}

                  {success && (
                    <Alert variant="success">
                      Upload successful. Receipt ID: {success.receiptId} ({success.filename})
                    </Alert>
                  )}

                  {isBusy && (
                    <div role="status" aria-busy="true" className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-sm text-ink-muted">
                        <Spinner size="sm" label={isUploading ? 'Uploading' : 'Reading receipt'} />
                        <span>{isUploading ? 'Uploading...' : 'Extracting receipt data...'}</span>
                      </div>
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  )}

                  {extractionError && (
                    <>
                      <Alert variant="error">{extractionError}</Alert>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleRetryExtraction}>
                          Retry
                        </Button>
                        <Button variant="secondary" size="sm" onClick={handleReset}>
                          Upload another receipt
                        </Button>
                      </div>
                    </>
                  )}

                  <Button
                    onClick={handleSubmit}
                    disabled={!file || !apartmentId || isBusy}
                    loading={isBusy}
                    loadingText={isUploading ? 'Uploading...' : 'Extracting...'}
                    aria-describedby={!file ? FILE_HELPER_ID : undefined}
                  >
                    Read receipt
                  </Button>

                  {!apartmentId && !file && (
                    <p id={FILE_HELPER_ID} className="text-sm text-ink-muted">
                      Choose an apartment and add a receipt to continue.
                    </p>
                  )}
                  {apartmentId && !file && (
                    <p id={FILE_HELPER_ID} className="text-sm text-ink-muted">
                      Choose a file to continue.
                    </p>
                  )}
                </>
              )}
            </div>
          </Card>
        </div>

        {isWideScreen && (
          <div className="lg:col-span-5">
            <HelpPanel />
          </div>
        )}
      </div>
    </div>
  )
}

export default ReceiptUpload
