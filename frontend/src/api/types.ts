export interface LineItem {
  name: string | null
  quantity: number | null
  unit_price: number | null
  line_total: number | null
}

export interface Discount {
  description: string | null
  amount: number | null
}

export interface Tax {
  description: string | null
  amount: number | null
}

export interface ReceiptWarning {
  code: string
  field: string
  message: string
  details: Record<string, string>
}

export type ReceiptStatus = 'needs_review' | 'approved'

/** GET /receipts' `file_type` filter: a JPEG (.jpg or .jpeg) is "jpg". */
export type ReceiptFileType = 'pdf' | 'jpg' | 'png'

/** GET /receipts' `sort` values (the backend's ALLOWED_RECEIPT_SORT_VALUES). */
export type ReceiptSort = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc' | 'uploaded_desc'

export interface ReceiptExtraction {
  receipt_id: string
  store_name: string | null
  purchase_date: string | null
  currency: string | null
  items: LineItem[]
  discounts: Discount[]
  taxes: Tax[]
  total: number | null
  warnings: ReceiptWarning[]
  edited: boolean
  edited_at: string | null
  apartment_id: string | null
  apartment_name: string | null
  status: ReceiptStatus
}

export interface Apartment {
  id: string
  name: string
}

export interface ReceiptSummary {
  receipt_id: string
  original_filename: string | null
  store_name: string | null
  purchase_date: string | null
  currency: string | null
  total: number | null
  created_at: string
  apartment_id: string | null
  apartment_name: string | null
  status: ReceiptStatus
}

export interface ApartmentFacet {
  id: string
  name: string
  count: number
}

export interface ReceiptFacets {
  apartments: ApartmentFacet[]
  total: number
  years: number[]
  has_undated: boolean
}

export type ItemSort = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc' | 'store'

export interface ItemRow {
  receipt_id: string
  line_index: number
  name: string | null
  quantity: number | null
  unit_price: number | null
  line_total: number | null
  currency: string | null
  purchase_date: string | null
  store_name: string | null
  apartment_id: string | null
  apartment_name: string | null
  status: ReceiptStatus
}

export interface ItemsPage {
  items: ItemRow[]
  count: number
  total: number
}

/** The backend's `basis` field on a yearly report. The frontend never
 * requests "approved" (no basis toggle, see docs/design.md), so it is
 * always "all" in practice; kept to mirror the response shape. */
export type ReportBasis = 'all' | 'approved'

/** One currency's total within a yearly report scope (an apartment, a
 * month, or the overall combined total). `total` is a decimal string
 * (e.g. "1234.56", "-12.50") -- already rounded server-side, never
 * parsed back into a number for arithmetic on the frontend. */
export interface ReportCurrencyTotal {
  currency: string
  total: string
  receipt_count: number
}

export interface ReportMonth {
  month: number
  by_currency: ReportCurrencyTotal[]
}

export interface ReportApartmentSummary {
  apartment_id: string
  apartment_name: string
  by_currency: ReportCurrencyTotal[]
  months: ReportMonth[]
}

export interface ReportExcludedCounts {
  undated: number
  not_approved: number
  no_total: number
  no_currency: number
  no_apartment: number
}

export interface ReportAttentionReceipt {
  receipt_id: string
  store_name: string | null
  purchase_date: string
  total: string
  currency: string
  apartment_id: string
  warning_codes: string[]
}

export interface ReportDuplicateGroup {
  receipt_ids: string[]
  store_name: string
  purchase_date: string
  total: string
  currency: string
  apartment_id: string
}

export interface ReportLargestReceipt {
  receipt_id: string
  store_name: string | null
  purchase_date: string
  total: string
  apartment_id: string
}

export interface ReportCurrencyLargest {
  currency: string
  items: ReportLargestReceipt[]
}

export interface YearlyReport {
  year: number
  basis: ReportBasis
  apartments: ReportApartmentSummary[]
  overall: ReportCurrencyTotal[]
  /** Both apartments together per month (same shape as an apartment's
   * `months`, only months with data) -- summed by the backend from the same
   * counted receipts as `overall`; the frontend never adds amounts. */
  overall_months: ReportMonth[]
  excluded: ReportExcludedCounts
  with_warnings: number
  counted_unreviewed: number
  attention: ReportAttentionReceipt[]
  possible_duplicates: ReportDuplicateGroup[]
  possible_duplicate_groups: number
  largest: ReportCurrencyLargest[]
}
