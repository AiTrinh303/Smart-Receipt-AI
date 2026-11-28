import type { ReportDuplicateGroup, YearlyReport } from './api/types'

/** Counts behind the export note. `notReviewed` is `counted_unreviewed`:
 * receipts still "Needs review" that are counted in the totals (the page
 * always uses basis "all"). */
export interface ExportOpenItems {
  notReviewed: number
  withWarnings: number
  undated: number
  noTotal: number
  noCurrency: number
  noApartment: number
  /** Groups of possible duplicates (`possible_duplicate_groups`, the full
   * count) and the groups themselves (`possible_duplicates`, capped at 50
   * server-side) -- a re-photographed receipt is counted twice in the
   * totals until one copy is deleted, so this always stays visible. */
  possibleDuplicates: number
  duplicateGroups: ReportDuplicateGroup[]
}

export function exportOpenItems(report: YearlyReport): ExportOpenItems {
  return {
    notReviewed: report.counted_unreviewed,
    withWarnings: report.with_warnings,
    undated: report.excluded.undated,
    noTotal: report.excluded.no_total,
    noCurrency: report.excluded.no_currency,
    noApartment: report.excluded.no_apartment,
    possibleDuplicates: report.possible_duplicate_groups,
    duplicateGroups: report.possible_duplicates,
  }
}
