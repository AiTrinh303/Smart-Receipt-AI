import { ApiError } from './ApiError'
import type { YearlyReport } from './types'

export interface GetYearlyReportOptions {
  year: number
}

const API_URL = import.meta.env.VITE_API_URL

/** GET /reports/yearly for one year. Never sends `basis`: the page always
 * uses the backend's default ("all" -- every saved receipt counts), see
 * docs/design.md "Report: year in the header, no basis toggle". */
export async function getYearlyReport(options: GetYearlyReportOptions): Promise<YearlyReport> {
  const { year } = options

  const params = new URLSearchParams({ year: String(year) })

  const response = await fetch(`${API_URL}/reports/yearly?${params.toString()}`)

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.detail ?? 'Could not load the yearly report.', response.status)
  }

  return response.json()
}
