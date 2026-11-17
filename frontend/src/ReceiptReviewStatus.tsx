import type { SavedReceipt } from './api/getReceipt'
import type { ReceiptStatus } from './api/types'
import { useReceiptReviewStatus } from './hooks/useReceiptReviewStatus'
import Alert from './components/ui/Alert'
import Button from './components/ui/Button'
import StatusBadge from './components/ui/StatusBadge'

interface ReceiptReviewStatusProps {
  receiptId: string
  status: ReceiptStatus
  onUpdated: (updated: SavedReceipt) => void
}

/** A standalone review-status control (badge + approve/revert button),
 * kept for any future standalone use -- the saved-receipt view itself now
 * shows this same control inside ReviewBar (see ReviewBar.tsx), which
 * shares this exact request/error logic via useReceiptReviewStatus rather
 * than duplicating it. */
function ReceiptReviewStatus({ receiptId, status, onUpdated }: ReceiptReviewStatusProps) {
  const { isSavingStatus, statusError, handleStatusChange } = useReceiptReviewStatus(receiptId, onUpdated)

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
