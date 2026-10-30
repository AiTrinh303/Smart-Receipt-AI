import type { ReceiptStatus } from '../../api/types'

function NeedsReviewIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 flex-shrink-0" fill="none">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 6.5V10l2.5 1.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ApprovedIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 flex-shrink-0" fill="none">
      <path
        d="M4 10.5l3.5 3.5L16 5.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export const STATUS_LABELS: Record<ReceiptStatus, string> = {
  needs_review: 'Needs review',
  approved: 'Approved',
}

/** Review status, shown on a saved receipt and in the history list. Never
 * conveyed by color alone -- a distinct icon always accompanies the label,
 * same reasoning as RadioCardGroup's selected-state check icon. */
function StatusBadge({ status }: { status: ReceiptStatus }) {
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
        <ApprovedIcon />
        {STATUS_LABELS.approved}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
      <NeedsReviewIcon />
      {STATUS_LABELS.needs_review}
    </span>
  )
}

export default StatusBadge
