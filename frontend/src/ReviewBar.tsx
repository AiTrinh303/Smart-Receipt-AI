import type { SavedReceipt } from './api/getReceipt'
import type { ReceiptStatus } from './api/types'
import { useBottomBarVariant } from './hooks/useBottomBarVariant'
import { useReceiptReviewStatus } from './hooks/useReceiptReviewStatus'
import Alert from './components/ui/Alert'
import Button from './components/ui/Button'
import StatusBadge from './components/ui/StatusBadge'
import { isPlainLeftClick } from './navigation'

export interface ReviewNavigationNeighbour {
  id: string
  href: string
}

export interface ReviewNavigation {
  /** 0-based index of the current receipt within the snapshot, and the
   * snapshot's total size -- shown as "N of M" (1-based). */
  position: { index: number; total: number }
  previous: ReviewNavigationNeighbour | null
  next: ReviewNavigationNeighbour | null
  onNavigate: (id: string) => void
  /** Called only after a successful "Approve and next" request, with the
   * updated receipt -- deciding where to go next (the snapshot's next
   * still-needs-review receipt, or back to the list) needs the caller's
   * own snapshot state, so it stays the caller's job, not ReviewBar's. */
  onApprovedAndNext: (updated: SavedReceipt) => void
}

interface ReviewBarProps {
  receiptId: string
  status: ReceiptStatus
  onUpdated: (updated: SavedReceipt) => void
  /** Present only when this receipt was opened from a filtered/tabbed
   * history list whose snapshot (up to 200 receipts) was fetched
   * successfully and contains this receipt -- otherwise every review-mode
   * control below is simply absent, and ReviewBar behaves exactly as it
   * did before review mode existed. */
  reviewNavigation?: ReviewNavigation
  /** How many data-quality warnings this receipt has. While it still needs
   * review, a non-zero count shows a "N warnings to check" link to the
   * element with id `warningsTargetId` (the warning panel's heading line).
   * Purely a pointer -- approving is never blocked by it. */
  warningCount?: number
  warningsTargetId?: string
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
 * screen. Only ever one variant is mounted.
 *
 * When `reviewNavigation` is given, also shows where this receipt sits in
 * the list it was opened from ("N of M"), Previous/Next links to its
 * neighbours, and a second "Approve and next" button next to "Mark as
 * approved". */
function ReviewBar({
  receiptId,
  status,
  onUpdated,
  reviewNavigation,
  warningCount = 0,
  warningsTargetId,
}: ReviewBarProps) {
  const { isSavingStatus, statusError, handleStatusChange } = useReceiptReviewStatus(receiptId, onUpdated)
  const useBottomVariant = useBottomBarVariant()

  const barClassName = useBottomVariant
    ? 'fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface px-4 py-3 shadow-popover'
    : 'sticky top-20 z-10 rounded-card border border-border-subtle bg-surface px-4 py-3 shadow-card'

  const handleApproveAndNext = async () => {
    const updated = await handleStatusChange('approved')
    if (updated) {
      reviewNavigation?.onApprovedAndNext(updated)
    }
  }

  return (
    <div className={barClassName}>
      <div className="mx-auto flex max-w-4xl flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={status} />
          {status === 'needs_review' ? (
            <>
              {/* In review mode "Approve and next" is the main action (one
                  primary button, first); "Mark as approved" steps down to
                  secondary. Outside review mode it stays the only, primary
                  button. */}
              {reviewNavigation && (
                <Button variant="primary" size="sm" disabled={isSavingStatus} onClick={handleApproveAndNext}>
                  Approve and next
                </Button>
              )}
              <Button
                variant={reviewNavigation ? 'secondary' : 'primary'}
                size="sm"
                disabled={isSavingStatus}
                onClick={() => handleStatusChange('approved')}
              >
                Mark as approved
              </Button>
            </>
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
          {status === 'needs_review' && warningCount > 0 && warningsTargetId && (
            <WarningsLink count={warningCount} targetId={warningsTargetId} />
          )}
        </div>

        {reviewNavigation && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <p role="status" className="text-ink-muted">
              {reviewNavigation.position.index + 1} of {reviewNavigation.position.total}
            </p>
            <ReviewNavLink label="Previous" neighbour={reviewNavigation.previous} onNavigate={reviewNavigation.onNavigate} />
            <ReviewNavLink label="Next" neighbour={reviewNavigation.next} onNavigate={reviewNavigation.onNavigate} />
          </div>
        )}
      </div>
      {statusError && (
        <div className="mx-auto mt-2 max-w-4xl">
          <Alert variant="error">{statusError}</Alert>
        </div>
      )}
    </div>
  )
}

function WarningIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 flex-shrink-0" fill="none">
      <path d="M10 3.5l8 13.5H2l8-13.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 8.5v3.5M10 14.75h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** A real in-page link (`href="#<id>"`, so it still works without script),
 * whose click scrolls the warning panel into the middle of the viewport --
 * clear of the sticky bar at the top (lg up) or the fixed bar at the bottom
 * (below lg) -- and moves focus there, so keyboard and screen-reader users
 * land on it too. No smooth scrolling, so reduced-motion needs nothing. */
function WarningsLink({ count, targetId }: { count: number; targetId: string }) {
  return (
    <a
      href={`#${targetId}`}
      onClick={(e) => {
        const target = document.getElementById(targetId)
        if (!target) {
          return
        }
        if (!isPlainLeftClick(e)) {
          return
        }
        e.preventDefault()
        target.scrollIntoView?.({ block: 'center' })
        target.focus({ preventScroll: true })
      }}
      className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-warning underline hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:min-h-0"
    >
      <WarningIcon />
      {count === 1 ? '1 warning to check' : `${count} warnings to check`}
    </a>
  )
}

function ReviewNavLink({
  label,
  neighbour,
  onNavigate,
}: {
  label: string
  neighbour: ReviewNavigationNeighbour | null
  onNavigate: (id: string) => void
}) {
  if (!neighbour) {
    return (
      <span aria-disabled="true" className="font-medium text-ink-muted/50">
        {label}
      </span>
    )
  }

  return (
    <a
      href={neighbour.href}
      onClick={(e) => {
        if (!isPlainLeftClick(e)) {
          return
        }
        e.preventDefault()
        onNavigate(neighbour.id)
      }}
      className="font-medium text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      {label}
    </a>
  )
}

export default ReviewBar
