import { useState } from 'react'

const ACCEPTED_TYPES = ['image/jpeg', 'image/png']

function isValidFile(file: File) {
  return ACCEPTED_TYPES.includes(file.type)
}

function ReceiptUpload() {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (!selected) {
      return
    }

    if (!isValidFile(selected)) {
      setFile(null)
      setError('Invalid file type. Please select a JPG or PNG image.')
      return
    }

    setFile(selected)
    setError(null)
  }

  const handleSubmit = () => {
    if (!file) {
      setError('Please select a file before submitting.')
      return
    }

    console.log(file)
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
        className="block w-full text-sm text-gray-700 file:mr-4 file:rounded file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-blue-700"
      />

      {file && <p className="text-sm text-gray-600">Selected file: {file.name}</p>}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!file}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        Submit
      </button>
    </div>
  )
}

export default ReceiptUpload
