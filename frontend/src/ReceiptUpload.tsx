import { useState } from 'react'
import { ApiError } from './api/ApiError'
import { extractReceipt } from './api/extractReceipt'
import { uploadReceipt } from './api/uploadReceipt'
import type { ReceiptExtraction } from './api/types'
import ReceiptResult from './ReceiptResult'

const ACCEPTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.pdf']
const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf']
const PDF_SIGNATURE = '%PDF-'

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

interface UploadSuccess {
  receiptId: string
  filename: string
}

const NETWORK_ERROR_MESSAGE = 'Could not reach the server. Please try again.'
const EXTRACTION_FAILED_MESSAGE =
  'We could not read this receipt. Please try again or upload a clearer image.'
const EXTRACTION_NOT_CONFIGURED_MESSAGE =
  'The AI service is not configured. Please try again later.'

function ReceiptUpload() {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<UploadSuccess | null>(null)
  const [isUploading, setIsUploading] = useState(false)

  const [receiptId, setReceiptId] = useState<string | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [extractionError, setExtractionError] = useState<string | null>(null)
  const [result, setResult] = useState<ReceiptExtraction | null>(null)

  const runExtraction = async (id: string) => {
    setIsExtracting(true)
    setExtractionError(null)

    try {
      const data = await extractReceipt(id)
      setResult(data)
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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (!selected) {
      return
    }

    setSuccess(null)
    setResult(null)
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

  const handleSubmit = async () => {
    if (!file) {
      setError('Please select a file before submitting.')
      return
    }

    setIsUploading(true)
    setError(null)
    setSuccess(null)
    setResult(null)
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

  const handleReset = () => {
    setFile(null)
    setError(null)
    setSuccess(null)
    setIsUploading(false)
    setReceiptId(null)
    setIsExtracting(false)
    setExtractionError(null)
    setResult(null)
  }

  if (result) {
    return <ReceiptResult data={result} onReset={handleReset} />
  }

  const isBusy = isUploading || isExtracting

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 rounded-lg border border-gray-300 p-6">
      <label htmlFor="receipt-file" className="text-sm font-medium text-gray-700">
        Upload receipt (JPG, PNG, or PDF)
      </label>
      <input
        id="receipt-file"
        type="file"
        accept=".jpg,.jpeg,.png,.pdf"
        onChange={handleFileChange}
        disabled={isBusy}
        className="block w-full text-sm text-gray-700 file:mr-4 file:rounded file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-blue-700"
      />

      {file && <p className="text-sm text-gray-600">Selected file: {file.name}</p>}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {success && (
        <p className="text-sm text-green-600">
          Upload successful. Receipt ID: {success.receiptId} ({success.filename})
        </p>
      )}

      {isExtracting && <p className="text-sm text-gray-600">Extracting receipt data...</p>}

      {extractionError && (
        <>
          <p role="alert" className="text-sm text-red-600">
            {extractionError}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleRetryExtraction}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="rounded bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-800"
            >
              Upload another receipt
            </button>
          </div>
        </>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!file || isBusy}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        {isUploading ? 'Uploading...' : isExtracting ? 'Extracting...' : 'Submit'}
      </button>
    </div>
  )
}

export default ReceiptUpload
