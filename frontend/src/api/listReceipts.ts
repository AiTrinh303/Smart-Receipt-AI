import { ApiError } from './ApiError'
import type { ReceiptStatus, ReceiptSummary } from './types'

export interface ListReceiptsResponse {
  items: ReceiptSummary[]
  count: number
  total: number
}

export interface ListReceiptsOptions {
  limit?: number
  offset?: number
  apartmentId?: string
  /** A 4-digit year as a string, or "none" for an undated receipt. */
  year?: string
  status?: ReceiptStatus
}

const API_URL = import.meta.env.VITE_API_URL

export async function listReceipts(options: ListReceiptsOptions = {}): Promise<ListReceiptsResponse> {
  const { limit = 50, offset, apartmentId, year, status } = options

  const params = new URLSearchParams({ limit: String(limit) })
  if (offset !== undefined) params.set('offset', String(offset))
  if (apartmentId) params.set('apartment_id', apartmentId)
  if (year) params.set('year', year)
  if (status) params.set('status', status)

  const response = await fetch(`${API_URL}/receipts?${params.toString()}`)

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.detail ?? 'Could not load receipt history.', response.status)
  }

  return response.json()
}
