import { useState } from 'react'
import { ApiError } from './api/ApiError'
import { updateReceiptStatus } from './api/updateReceiptStatus'
import type { SavedReceipt } from './api/getReceipt'
import type { ReceiptStatus } from './api/types'
import Alert from './components/ui/Alert'
import Button from './components/ui/Button'
import StatusBadge from './components/ui/StatusBadge'

interface ReceiptReviewStatusProps {
  receiptId: string
  status: ReceiptStatus
  onUpdated: (updated: SavedReceipt) => void
}

const NETWORK_ERROR_MESSAGE = 'Could not reach the server. Please try again.'

const MISSING_FIELD_LABELS: Record<string, string> = {
  apartment: 'apartment',
  date: 'a valid purchase date',
  total: 'total',
}

/** Any code this app no longer recognizes (e.g. a stray "category" from an
 * older server) is silently dropped rather than shown as a raw code or
 * "undefined". */
function describeMissing(missing: string[]): string {
  const labels = missing
    .map((code) => MISSING_FIELD_LABELS[code])
    .filter((label): label is string => label !== undefined)
  if (labels.length === 0) {
    return 'To approve this receipt, a few more details are needed.'
  }
  const message = `To approve this receipt, also set: ${labels.join(', ')}.`
  return missing.includes('date') ? `${message} You can fix the date with Edit.` : message
}

/** Shown on the saved-receipt view next to ReceiptApartment -- never inside
 * ReceiptResult itself -- and hidden while the edit form is open. Lets the
 * review status be changed independently of editing the receipt's data, via
 * PUT /receipts/{id}/status. Never calls extract or the plain
 * PUT /receipts/{id}. */
function ReceiptReviewStatus({ receiptId, status, onUpdated }: ReceiptReviewStatusProps) {
  const [isSavingStatus, setIsSavingStatus] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)

  const handleStatusChange = async (newStatus: ReceiptStatus) => {
    setStatusError(null)
    setIsSavingStatus(true)

    try {
      const updated = await updateReceiptStatus(receiptId, newStatus)
      onUpdated(updated)
    } catch (err) {
      if (err instanceof ApiError && err.missing && err.missing.length > 0) {
        setStatusError(describeMissing(err.missing))
      } else {
        setStatusError(err instanceof ApiError ? err.message : NETWORK_ERROR_MESSAGE)
      }
    } finally {
      setIsSavingStatus(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-ink">Status</span>
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={status} />
        {status === 'needs_review' ? (
          <Button
            variant="primary"
            size="sm"
            disabled={isSavingStatus}
            onClick={() => handleStatusChange('approved')}
          >
            Mark as approved
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled={isSavingStatus}
            onClick={() => handleStatusChange('needs_review')}
          >
            Back to needs review
          </Button>
        )}
      </div>
      {isSavingStatus && <p className="text-sm text-ink-muted">Saving...</p>}
      {statusError && <Alert variant="error">{statusError}</Alert>}
    </div>
  )
}

export default ReceiptReviewStatus
