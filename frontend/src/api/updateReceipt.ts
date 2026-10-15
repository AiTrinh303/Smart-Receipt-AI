import { ApiError } from './ApiError'
import type { ReceiptExtraction } from './types'

export interface ReceiptEditableItem {
  name: string
  quantity: number | null
  unit_price: number | null
  line_total: number | null
}

export interface ReceiptEditableAmount {
  description: string
  amount: number | null
}

export interface ReceiptEditableFields {
  store_name: string | null
  purchase_date: string | null
  currency: string | null
  items: ReceiptEditableItem[]
  discounts: ReceiptEditableAmount[]
  taxes: ReceiptEditableAmount[]
  total: number | null
}

const API_URL = import.meta.env.VITE_API_URL

interface ValidationErrorItem {
  loc?: unknown[]
  msg?: string
}

function formatValidationErrors(detail: unknown): string {
  if (Array.isArray(detail)) {
    const messages = (detail as ValidationErrorItem[]).map((item) => {
      const loc = Array.isArray(item.loc)
        ? item.loc.filter((part) => part !== 'body').join('.')
        : ''
      return loc ? `${loc}: ${item.msg}` : (item.msg ?? 'Invalid value.')
    })
    return messages.join(' ')
  }
  if (typeof detail === 'string') {
    return detail
  }
  return 'Invalid input.'
}

export async function updateReceipt(
  receiptId: string,
  fields: ReceiptEditableFields,
): Promise<ReceiptExtraction> {
  const response = await fetch(`${API_URL}/receipts/${receiptId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const message =
      response.status === 422
        ? formatValidationErrors(body?.detail)
        : (body?.detail ?? 'Could not save your changes.')
    throw new ApiError(message, response.status)
  }

  return response.json()
}
