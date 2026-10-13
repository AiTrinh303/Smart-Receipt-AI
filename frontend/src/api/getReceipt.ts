import { ApiError } from './ApiError'
import type { ReceiptExtraction } from './types'

export interface SavedReceiptMetadata {
  original_filename: string | null
  content_type: string | null
  created_at: string
  updated_at: string
}

export type SavedReceipt = ReceiptExtraction & SavedReceiptMetadata

const API_URL = import.meta.env.VITE_API_URL

export async function getReceipt(receiptId: string): Promise<SavedReceipt> {
  const response = await fetch(`${API_URL}/receipts/${receiptId}`)

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.detail ?? 'Could not load receipt.', response.status)
  }

  return response.json()
}
