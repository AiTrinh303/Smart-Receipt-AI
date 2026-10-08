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

export interface ReceiptExtraction {
  receipt_id: string
  store_name: string | null
  purchase_date: string | null
  currency: string | null
  items: LineItem[]
  discounts: Discount[]
  taxes: Tax[]
  total: number | null
}
