import { useEffect, useRef, useState } from 'react'
import { ApiError } from './api/ApiError'
import { deleteReceipt } from './api/deleteReceipt'
import { extractReceipt } from './api/extractReceipt'
import { getReceipt } from './api/getReceipt'
import { uploadReceipt } from './api/uploadReceipt'
import type { ReceiptExtraction } from './api/types'
import { navigateTo } from './navigation'
import ReceiptDetailLayout from './ReceiptDetailLayout'
import ReceiptEditForm from './ReceiptEditForm'
import ReceiptResult from './ReceiptResult'
import Alert from './components/ui/Alert'
import Button from './components/ui/Button'
import Card from './components/ui/Card'
import Spinner from './components/ui/Spinner'
import { formatFileSize } from './components/ui/formatFileSize'

const ACCEPTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.pdf']
const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf']
const PDF_SIGNATURE = '%PDF-'
const RECEIPT_QUERY_PARAM = 'receipt'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function getExtension(filename: string) {
  const index = filename.lastIndexOf('.')
  return index === -1 ? '' : filename.slice(index).toLowerCase()
}

function isValidFile(file: File) {
  const extension = getExtension(file.name)
  if (!ACCEPTED_EXTENSIONS.includes(extension)) {
    return false
  }

  // Some browsers/environments don't always set `file.type`; only check it
  // when it's present, since the extension check already narrowed the type.
  if (file.type && !ACCEPTED_MIME_TYPES.includes(file.type)) {
    return false
  }

  return true
}

function readAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsText(blob)
  })
}

async function isLikelyValidPdf(file: File): Promise<boolean> {
  const header = await readAsText(file.slice(0, PDF_SIGNATURE.length))
  return header === PDF_SIGNATURE
}

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
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
  const query = params.toString()
  const newUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
  window.history.replaceState({}, '', newUrl)
}

interface UploadSuccess {
  receiptId: string
  filename: string
}

const NETWORK_ERROR_MESSAGE = 'Could not reach the server. Please try again.'
const EXTRACTION_FAILED_MESSAGE =
  'We could not read this receipt. Please try again or upload a clearer image.'
const EXTRACTION_NOT_CONFIGURED_MESSAGE =
  'The AI service is not available (not configured or out of credit). Please check the server settings.'
const LOAD_RECEIPT_FAILED_MESSAGE = 'Could not load this receipt. Please try again.'

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

function ReceiptUpload() {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<UploadSuccess | null>(null)
  const [isUploading, setIsUploading] = useState(false)

  const [receiptId, setReceiptId] = useState<string | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [extractionError, setExtractionError] = useState<string | null>(null)
  const [result, setResult] = useState<ReceiptResultData | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const initialReceipt = getReceiptIdFromUrl()
  const [isLoadingReceipt, setIsLoadingReceipt] = useState(initialReceipt.id !== null)
  const [notFound, setNotFound] = useState(initialReceipt.invalid)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

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
    setSuccess(null)
    setResult(null)
    setIsEditing(false)
    setExtractionError(null)
    setReceiptId(null)

    if (!isValidFile(selected)) {
      setFile(null)
      setError('Invalid file type. Please select a JPG, PNG, or PDF file.')
      return
    }

    if (getExtension(selected.name) === '.pdf' && !(await isLikelyValidPdf(selected))) {
      setFile(null)
      setError('This file does not look like a valid PDF.')
      return
    }

    setFile(selected)
    setError(null)
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    e.target.value = ''
    if (!selected) {
      return
    }
    await processFile(selected)
  }

  const handleRemoveFile = () => {
    setFile(null)
    setError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    if (cameraInputRef.current) {
      cameraInputRef.current.value = ''
    }
  }

  const openFilePicker = () => {
    if (!(isUploading || isExtracting)) {
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

    const droppedFiles = e.dataTransfer.files
    if (droppedFiles.length > 1) {
      setSuccess(null)
      setResult(null)
      setIsEditing(false)
      setExtractionError(null)
      setReceiptId(null)
      setFile(null)
      setError('Please drop one receipt at a time.')
      return
    }

    const dropped = droppedFiles[0]
    if (dropped) {
      await processFile(dropped)
    }
  }

  const handleSubmit = async () => {
    if (!file) {
      setError('Please select a file before submitting.')
      return
    }

    setIsUploading(true)
    setError(null)
    setSuccess(null)
    setResult(null)
    setIsEditing(false)
    setExtractionError(null)

    try {
      const uploadResult = await uploadReceipt(file)
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

  const handleReset = () => {
    setFile(null)
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
    return (
      <div className="flex flex-col gap-4">
        {!isConfirmingDelete && (
          <a
            href="/?view=history"
            onClick={(e) => {
              e.preventDefault()
              navigateTo('?view=history')
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
            Back to history
          </a>
        )}

        <ReceiptDetailLayout receiptId={result.receipt_id} fileName={resultFileName} contentType={resultContentType}>
          <div className="flex flex-col gap-4">
            <ReceiptResult data={result} onReset={handleReset} onEdit={() => setIsEditing(true)} />

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
            ) : (
              <div className="flex justify-end border-t border-border pt-3">
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
      <div className="mx-auto flex max-w-md flex-col gap-4 rounded-lg border border-gray-300 p-6">
        <p className="text-sm text-gray-600">Loading receipt...</p>
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

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <label htmlFor="receipt-file" className="sr-only">
          Upload receipt (JPG, PNG, or PDF)
        </label>
        <input
          ref={fileInputRef}
          id="receipt-file"
          type="file"
          accept=".jpg,.jpeg,.png,.pdf"
          onChange={handleFileChange}
          disabled={isBusy}
          className="sr-only"
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          disabled={isBusy}
          aria-hidden="true"
          tabIndex={-1}
          className="sr-only"
        />

        <div
          role="button"
          tabIndex={isBusy ? -1 : 0}
          aria-disabled={isBusy}
          onClick={openFilePicker}
          onKeyDown={handleZoneKeyDown}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
            isBusy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-brand hover:bg-brand-soft'
          } ${isDragOver ? 'border-brand bg-brand-soft' : 'border-border'}`}
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
          <p className="text-sm font-medium text-ink">Drag a receipt here, or choose a file</p>
          <p className="text-sm text-ink-muted">JPG, PNG or PDF, up to 10 MB</p>
        </div>

        <Button
          variant="secondary"
          size="sm"
          disabled={isBusy}
          onClick={() => cameraInputRef.current?.click()}
          className="w-full sm:hidden"
        >
          Take photo
        </Button>

        {file && (
          <div className="flex items-center gap-3 rounded-md border border-border bg-surface-page px-3 py-2">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-5 w-5 flex-shrink-0 text-ink-muted"
              fill="none"
            >
              <path
                d="M6 2h8l4 4v16H6z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
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
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <Spinner size="sm" label={isUploading ? 'Uploading' : 'Reading receipt'} />
            <span>{isUploading ? 'Uploading...' : 'Extracting receipt data...'}</span>
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
          disabled={!file || isBusy}
          loading={isBusy}
          loadingText={isUploading ? 'Uploading...' : 'Extracting...'}
        >
          Read receipt
        </Button>

        <p className="flex items-start gap-1.5 text-sm text-ink-muted">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 flex-shrink-0" fill="none">
            <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M10 9v4.5M10 6.75h.01"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          The file is sent to OpenAI to read it. The extracted data is saved in this app.
        </p>
      </Card>
    </div>
  )
}

export default ReceiptUpload
