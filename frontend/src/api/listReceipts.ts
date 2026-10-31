import { ApiError } from './ApiError'
import type { ReceiptStatus, ReceiptSummary } from './types'

export interface ListReceiptsResponse {
  items: ReceiptSummary[]
  count: number
}

export interface ListReceiptsOptions {
  limit?: number
  apartmentId?: string
  /** A 4-digit year as a string, or "none" for an undated receipt. */
  year?: string
  status?: ReceiptStatus
  /** A known category id, or "none" for no category. */
  categoryId?: string
}

const API_URL = import.meta.env.VITE_API_URL

export async function listReceipts(options: ListReceiptsOptions = {}): Promise<ListReceiptsResponse> {
  const { limit = 50, apartmentId, year, status, categoryId } = options

  const params = new URLSearchParams({ limit: String(limit) })
  if (apartmentId) params.set('apartment_id', apartmentId)
  if (year) params.set('year', year)
  if (status) params.set('status', status)
  if (categoryId) params.set('category_id', categoryId)

  const response = await fetch(`${API_URL}/receipts?${params.toString()}`)

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.detail ?? 'Could not load receipt history.', response.status)
  }

  return response.json()
}
