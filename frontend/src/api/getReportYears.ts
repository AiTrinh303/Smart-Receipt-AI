import { ApiError } from './ApiError'

export interface GetReportYearsResponse {
  items: number[]
}

const API_URL = import.meta.env.VITE_API_URL

export async function getReportYears(): Promise<GetReportYearsResponse> {
  const response = await fetch(`${API_URL}/reports/years`)

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.detail ?? 'Could not load the report years.', response.status)
  }

  return response.json()
}
