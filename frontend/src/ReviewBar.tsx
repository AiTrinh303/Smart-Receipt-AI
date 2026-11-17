import type { SavedReceipt } from './api/getReceipt'
import type { ReceiptStatus } from './api/types'
import { useBottomBarVariant } from './hooks/useBottomBarVariant'
import { useReceiptReviewStatus } from './hooks/useReceiptReviewStatus'
import Alert from './components/ui/Alert'
import Button from './components/ui/Button'
import StatusBadge from './components/ui/StatusBadge'

interface ReviewBarProps {
  receiptId: string
  status: ReceiptStatus
  onUpdated: (updated: SavedReceipt) => void
}

/** The saved-receipt view's main action, placed at the top of the data
 * column instead of buried below two stacked sections: the review-status
 * badge and the primary approve/revert button, reusing
 * useReceiptReviewStatus's exact request and 422-message logic (never
 * duplicated -- ReceiptReviewStatus.tsx uses the same hook). From `lg` up
 * it stays in view by sticking under the header while the data column
 * scrolls past it; below `lg` (or wherever `matchMedia` isn't available)
 * it instead sticks to the bottom of the viewport, so it's always
 * reachable without competing for space with the receipt image on a small
 * screen. Only ever one variant is mounted. */
function ReviewBar({ receiptId, status, onUpdated }: ReviewBarProps) {
  const { isSavingStatus, statusError, handleStatusChange } = useReceiptReviewStatus(receiptId, onUpdated)
  const useBottomVariant = useBottomBarVariant()

  const barClassName = useBottomVariant
    ? 'fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface px-4 py-3 shadow-popover'
    : 'sticky top-20 z-10 rounded-card border border-border-subtle bg-surface px-4 py-3 shadow-card'

  return (
    <div className={barClassName}>
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3">
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
        {isSavingStatus && <p className="text-sm text-ink-muted">Saving...</p>}
      </div>
      {statusError && (
        <div className="mx-auto mt-2 max-w-4xl">
          <Alert variant="error">{statusError}</Alert>
        </div>
      )}
    </div>
  )
}

export default ReviewBar
