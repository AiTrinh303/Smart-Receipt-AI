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
