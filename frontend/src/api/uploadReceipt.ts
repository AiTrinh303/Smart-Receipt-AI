import { ApiError } from './ApiError'

export { ApiError }

export interface UploadReceiptResponse {
  receipt_id: string
  filename: string
  content_type: string
  size_bytes: number
}

const API_URL = import.meta.env.VITE_API_URL

export async function uploadReceipt(file: File, apartmentId: string): Promise<UploadReceiptResponse> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('apartment_id', apartmentId)

  const response = await fetch(`${API_URL}/receipts/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.detail ?? 'Upload failed.', response.status)
  }

  return response.json()
}
