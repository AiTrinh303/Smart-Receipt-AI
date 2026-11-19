import { ApiError } from './ApiError'
import type { ReportBasis, YearlyReport } from './types'

export interface GetYearlyReportOptions {
  year: number
  /** Omitted entirely when "all" (the backend's own default), so the URL
   * only ever carries `basis=approved` when the owner opted into it. */
  basis?: ReportBasis
}

const API_URL = import.meta.env.VITE_API_URL

export async function getYearlyReport(options: GetYearlyReportOptions): Promise<YearlyReport> {
  const { year, basis } = options

  const params = new URLSearchParams({ year: String(year) })
  if (basis && basis !== 'all') params.set('basis', basis)

  const response = await fetch(`${API_URL}/reports/yearly?${params.toString()}`)

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.detail ?? 'Could not load the yearly report.', response.status)
  }

  return response.json()
}
