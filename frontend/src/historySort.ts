import { DEFAULT_RECEIPT_SORT } from './api/listReceipts'
import type { ReceiptSort } from './api/types'

/** The History list's "Sort by" choices, in menu order -- exactly the five
 * values GET /receipts' `sort` accepts. */
export const RECEIPT_SORT_OPTIONS: { value: ReceiptSort; label: string }[] = [
  { value: 'date_desc', label: 'Date (newest first)' },
  { value: 'date_asc', label: 'Date (oldest first)' },
  { value: 'amount_desc', label: 'Total (high to low)' },
  { value: 'amount_asc', label: 'Total (low to high)' },
  { value: 'uploaded_desc', label: 'Recently uploaded' },
]

export { DEFAULT_RECEIPT_SORT }

/** A `sort` URL value as a real sort: an unknown or missing value falls
 * back to the default (ignored, never sent as given -- same spirit as
 * every other History filter). */
export function effectiveReceiptSort(raw: string | null | undefined): ReceiptSort {
  return RECEIPT_SORT_OPTIONS.some((option) => option.value === raw) ? (raw as ReceiptSort) : DEFAULT_RECEIPT_SORT
}
