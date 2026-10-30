import { ApiError } from './ApiError'
import type { SavedReceipt } from './getReceipt'
import type { ReceiptStatus } from './types'

const API_URL = import.meta.env.VITE_API_URL

interface StatusErrorDetail {
  message: string
  missing: string[]
}

function isStatusErrorDetail(detail: unknown): detail is StatusErrorDetail {
  return (
    typeof detail === 'object' &&
    detail !== null &&
    typeof (detail as StatusErrorDetail).message === 'string' &&
    Array.isArray((detail as StatusErrorDetail).missing)
  )
}

export async function updateReceiptStatus(
  receiptId: string,
  status: ReceiptStatus,
): Promise<SavedReceipt> {
  const response = await fetch(`${API_URL}/receipts/${receiptId}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const detail = body?.detail
    // A 422 from the approval gate carries {message, missing: [...]} so the
    // UI can say exactly what's left to fill in; every other error (and a
    // malformed body) falls back to a plain message with no missing list.
    if (isStatusErrorDetail(detail)) {
      throw new ApiError(detail.message, response.status, detail.missing)
    }
    throw new ApiError(typeof detail === 'string' ? detail : 'Could not update the status.', response.status)
  }

  return response.json()
}
