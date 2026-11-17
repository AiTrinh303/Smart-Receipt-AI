import { useState } from 'react'
import { ApiError } from '../api/ApiError'
import { updateReceiptStatus } from '../api/updateReceiptStatus'
import type { SavedReceipt } from '../api/getReceipt'
import type { ReceiptStatus } from '../api/types'

const NETWORK_ERROR_MESSAGE = 'Could not reach the server. Please try again.'

const MISSING_FIELD_LABELS: Record<string, string> = {
  apartment: 'apartment',
  date: 'a valid purchase date',
  total: 'total',
}

/** Any code this app no longer recognizes (e.g. a stray "category" from an
 * older server) is silently dropped rather than shown as a raw code or
 * "undefined". */
export function describeMissing(missing: string[]): string {
  const labels = missing
    .map((code) => MISSING_FIELD_LABELS[code])
    .filter((label): label is string => label !== undefined)
  if (labels.length === 0) {
    return 'To approve this receipt, a few more details are needed.'
  }
  const message = `To approve this receipt, also set: ${labels.join(', ')}.`
  return missing.includes('date') ? `${message} You can fix the date with Edit.` : message
}

/** The PUT /receipts/{id}/status request and its 422 message, shared by
 * every place that lets a receipt's review status be changed (ReviewBar,
 * and ReceiptReviewStatus for any standalone use) -- kept in exactly one
 * place so the two never drift apart. Never calls extract or the plain
 * PUT /receipts/{id}. Resolves to the updated receipt on success, or null
 * on failure (with `statusError` set), so a caller like "Approve and
 * next" can tell the two apart without re-deriving them itself. */
export function useReceiptReviewStatus(receiptId: string, onUpdated: (updated: SavedReceipt) => void) {
  const [isSavingStatus, setIsSavingStatus] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)

  const handleStatusChange = async (newStatus: ReceiptStatus): Promise<SavedReceipt | null> => {
    setStatusError(null)
    setIsSavingStatus(true)

    try {
      const updated = await updateReceiptStatus(receiptId, newStatus)
      onUpdated(updated)
      return updated
    } catch (err) {
      if (err instanceof ApiError && err.missing && err.missing.length > 0) {
        setStatusError(describeMissing(err.missing))
      } else {
        setStatusError(err instanceof ApiError ? err.message : NETWORK_ERROR_MESSAGE)
      }
      return null
    } finally {
      setIsSavingStatus(false)
    }
  }

  return { isSavingStatus, statusError, handleStatusChange }
}
