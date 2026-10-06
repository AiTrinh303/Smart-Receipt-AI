import { useState } from 'react'
import { ApiError, uploadReceipt } from './api/uploadReceipt'

const ACCEPTED_TYPES = ['image/jpeg', 'image/png']

function isValidFile(file: File) {
  return ACCEPTED_TYPES.includes(file.type)
}

interface UploadSuccess {
  receiptId: string
  filename: string
}

function ReceiptUpload() {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<UploadSuccess | null>(null)
  const [isUploading, setIsUploading] = useState(false)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (!selected) {
      return
    }

    setSuccess(null)

    if (!isValidFile(selected)) {
      setFile(null)
      setError('Invalid file type. Please select a JPG or PNG image.')
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

    try {
      const result = await uploadReceipt(file)
      setSuccess({ receiptId: result.receipt_id, filename: result.filename })
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError('Could not reach the server. Please try again.')
      }
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 rounded-lg border border-gray-300 p-6">
      <label htmlFor="receipt-file" className="text-sm font-medium text-gray-700">
        Upload receipt (JPG or PNG)
      </label>
      <input
        id="receipt-file"
        type="file"
        accept=".jpg,.jpeg,.png"
        onChange={handleFileChange}
        disabled={isUploading}
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

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!file || isUploading}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        {isUploading ? 'Uploading...' : 'Submit'}
      </button>
    </div>
  )
}

export default ReceiptUpload
