import { ApiError } from './ApiError'
import type { ReceiptFacets } from './types'

const API_URL = import.meta.env.VITE_API_URL

export async function getReceiptFacets(apartmentId?: string): Promise<ReceiptFacets> {
  const params = new URLSearchParams()
  if (apartmentId) params.set('apartment_id', apartmentId)
  const query = params.toString()

  const response = await fetch(`${API_URL}/receipts/facets${query ? `?${query}` : ''}`)

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.detail ?? 'Could not load receipt history.', response.status)
  }

  return response.json()
}
