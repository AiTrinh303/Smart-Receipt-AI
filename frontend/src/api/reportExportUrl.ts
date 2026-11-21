import type { ReportBasis } from './types'

/** The two CSV styles GET /reports/yearly/export.csv and .zip accept --
 * excel_de (";" delimiter, BOM, decimal comma, German headers) or plain
 * (",", no BOM, decimal point, English headers). */
export type ExportStyle = 'excel_de' | 'plain'

export interface ReportExportUrlParams {
  year: number
  /** Omitted entirely when "all" (the backend's own default), same
   * convention as getYearlyReport.ts. */
  basis?: ReportBasis
  /** Always sent, even for the default "excel_de" -- so the downloaded
   * file's format never depends on a server-side default silently
   * changing later. */
  style: ExportStyle
  apartmentId?: string
}

const API_URL = import.meta.env.VITE_API_URL

function buildExportSearch(params: ReportExportUrlParams): string {
  const { year, basis, style, apartmentId } = params
  const search = new URLSearchParams({ year: String(year) })
  if (basis && basis !== 'all') search.set('basis', basis)
  search.set('style', style)
  if (apartmentId) search.set('apartment_id', apartmentId)
  return search.toString()
}

/** Builds the GET /reports/yearly/export.csv URL -- a plain <a href>,
 * never fetched with JavaScript: the server's Content-Disposition:
 * attachment header triggers the browser's own download. */
export function reportExportCsvUrl(params: ReportExportUrlParams): string {
  return `${API_URL}/reports/yearly/export.csv?${buildExportSearch(params)}`
}

/** Builds the GET /reports/yearly/export.zip URL -- same "plain link,
 * no fetch" contract as reportExportCsvUrl. */
export function reportExportZipUrl(params: ReportExportUrlParams): string {
  return `${API_URL}/reports/yearly/export.zip?${buildExportSearch(params)}`
}
