import { ApiError } from './ApiError'
import type { ReceiptSummary } from './types'

export interface ListReceiptsResponse {
  items: ReceiptSummary[]
  count: number
}

const API_URL = import.meta.env.VITE_API_URL

export async function listReceipts(limit = 50): Promise<ListReceiptsResponse> {
  const response = await fetch(`${API_URL}/receipts?limit=${limit}`)

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.detail ?? 'Could not load receipt history.', response.status)
  }

  return response.json()
}
