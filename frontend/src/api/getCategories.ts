import { ApiError } from './ApiError'
import type { Category } from './types'

export interface GetCategoriesResponse {
  items: Category[]
  count: number
}

const API_URL = import.meta.env.VITE_API_URL

export async function getCategories(): Promise<GetCategoriesResponse> {
  const response = await fetch(`${API_URL}/categories`)

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.detail ?? 'Could not load categories.', response.status)
  }

  return response.json()
}
