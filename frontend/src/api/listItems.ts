import { ApiError } from './ApiError'
import type { ItemSort, ItemsPage, ReceiptStatus } from './types'

export interface ListItemsOptions {
  apartmentId?: string
  /** A 4-digit year as a string, or "none" for an undated receipt. */
  year?: string
  status?: ReceiptStatus
  /** Trimmed search text, at most 100 characters. */
  q?: string
  sort?: ItemSort
  limit?: number
  offset?: number
}

const API_URL = import.meta.env.VITE_API_URL

export async function listItems(options: ListItemsOptions = {}): Promise<ItemsPage> {
  const { apartmentId, year, status, q, sort, limit, offset } = options

  const params = new URLSearchParams()
  if (apartmentId) params.set('apartment_id', apartmentId)
  if (year) params.set('year', year)
  if (status) params.set('status', status)
  if (q) params.set('q', q)
  if (sort) params.set('sort', sort)
  if (limit !== undefined) params.set('limit', String(limit))
  if (offset !== undefined) params.set('offset', String(offset))

  const response = await fetch(`${API_URL}/items?${params.toString()}`)

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.detail ?? 'Could not load items.', response.status)
  }

  return response.json()
}
