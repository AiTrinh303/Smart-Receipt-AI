import { ApiError } from './ApiError'
import type { ReceiptExtraction } from './types'

const API_URL = import.meta.env.VITE_API_URL

export async function extractReceipt(receiptId: string): Promise<ReceiptExtraction> {
  const response = await fetch(`${API_URL}/receipts/${receiptId}/extract`, {
    method: 'POST',
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.detail ?? 'Extraction failed.', response.status)
  }

  return response.json()
}
