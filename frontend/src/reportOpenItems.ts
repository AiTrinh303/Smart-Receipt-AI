import type { ReportBasis, YearlyReport } from './api/types'

/** Counts behind the export note. `notReviewed` is `counted_unreviewed`
 * under basis=all, or `excluded.not_approved` under basis=approved. */
export interface ExportOpenItems {
  notReviewed: number
  withWarnings: number
  undated: number
  noTotal: number
  noCurrency: number
  noApartment: number
}

export function exportOpenItems(report: YearlyReport, basis: ReportBasis): ExportOpenItems {
  return {
    notReviewed: basis === 'approved' ? report.excluded.not_approved : report.counted_unreviewed,
    withWarnings: report.with_warnings,
    undated: report.excluded.undated,
    noTotal: report.excluded.no_total,
    noCurrency: report.excluded.no_currency,
    noApartment: report.excluded.no_apartment,
  }
}
