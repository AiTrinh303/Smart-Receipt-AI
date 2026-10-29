import { ApiError } from './ApiError'
import type { ReceiptExtraction } from './types'

const API_URL = import.meta.env.VITE_API_URL

export async function resetReceipt(receiptId: string): Promise<ReceiptExtraction> {
  const response = await fetch(`${API_URL}/receipts/${receiptId}/reset`, {
    method: 'POST',
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.detail ?? 'Could not reset the receipt.', response.status)
  }

  return response.json()
}
