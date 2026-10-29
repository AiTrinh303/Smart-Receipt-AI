import { ApiError } from './ApiError'
import type { Apartment } from './types'

export interface GetApartmentsResponse {
  items: Apartment[]
  count: number
}

const API_URL = import.meta.env.VITE_API_URL

export async function getApartments(): Promise<GetApartmentsResponse> {
  const response = await fetch(`${API_URL}/apartments`)

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.detail ?? 'Could not load apartments.', response.status)
  }

  return response.json()
}
