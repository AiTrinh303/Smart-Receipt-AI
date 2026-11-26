import { ApiError, apiErrorFromDetail } from './ApiError'

export { ApiError }

export interface UploadReceiptResponse {
  receipt_id: string
  filename: string
  content_type: string
  size_bytes: number
}

const API_URL = import.meta.env.VITE_API_URL

export async function uploadReceipt(
  file: File,
  apartmentId: string,
  allowDuplicate?: boolean,
): Promise<UploadReceiptResponse> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('apartment_id', apartmentId)
  // Sent only when true, so a plain upload (and every existing test/call
  // site) behaves exactly as before.
  if (allowDuplicate) {
    formData.append('allow_duplicate', 'true')
  }

  const response = await fetch(`${API_URL}/receipts/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    // A 409 DUPLICATE_FILE carries an object detail ({code, message,
    // existing}); every other error still falls back to a plain message.
    throw apiErrorFromDetail(body?.detail, response.status, 'Upload failed.')
  }

  return response.json()
}
