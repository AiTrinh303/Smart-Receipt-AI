import Alert from '../components/ui/Alert'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'
import { formatFileSize } from '../components/ui/formatFileSize'
import type { BatchItem, BatchItemStatus, RejectedFile } from './batchReducer'

const STATUS_LABELS: Record<BatchItemStatus, string> = {
  waiting: 'Waiting',
  uploading: 'Uploading...',
  reading: 'Reading...',
  done: 'Done',
  failed: 'Failed',
}

function WaitingIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 flex-shrink-0" fill="none">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function DoneIcon() {
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

function FailedIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 flex-shrink-0" fill="none">
      <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 flex-shrink-0 text-ink-muted" fill="none">
      <path d="M6 2h8l4 4v16H6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M14 2v4h4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

function StatusChip({ status }: { status: BatchItemStatus }) {
  if (status === 'done') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
        <DoneIcon />
        {STATUS_LABELS.done}
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">
        <FailedIcon />
        {STATUS_LABELS.failed}
      </span>
    )
  }
  if (status === 'uploading' || status === 'reading') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">
        <Spinner size="sm" label="" />
        {STATUS_LABELS[status]}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-ink-muted">
      <WaitingIcon />
      {STATUS_LABELS.waiting}
    </span>
  )
}

export interface BatchQueueProps {
  items: BatchItem[]
  rejected: RejectedFile[]
  onRetry: (itemId: string) => void
  onRemove: (itemId: string) => void
}

function BatchQueue({ items, rejected, onRetry, onRemove }: BatchQueueProps) {
  const doneCount = items.filter((item) => item.status === 'done').length
  const failedCount = items.filter((item) => item.status === 'failed').length
  const totalCount = items.length
  const finishedCount = doneCount + failedCount

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="batch-progress" className="text-sm font-medium text-ink">
          Batch progress
        </label>
        <progress id="batch-progress" value={finishedCount} max={totalCount} className="h-2 w-full" />
        <p role="status" className="text-sm text-ink-muted">
          {doneCount} of {totalCount} read, {failedCount} failed
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.id} className="flex flex-col gap-2 rounded-md border border-border bg-surface-page px-3 py-2">
            <div className="flex items-center gap-3">
              <FileIcon />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink" title={item.file.name}>
                  {item.file.name}
                </p>
                <p className="text-xs text-ink-muted">{formatFileSize(item.file.size)}</p>
              </div>
              <StatusChip status={item.status} />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {item.status === 'done' && item.receiptId && (
                <a
                  href={`/?receipt=${item.receiptId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-brand underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  Open
                </a>
              )}
              {item.status === 'done' && (item.warningsCount ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
                  Check values ({item.warningsCount})
                </span>
              )}
              {item.status === 'failed' && (
                <Button variant="secondary" size="sm" onClick={() => onRetry(item.id)}>
                  Retry
                </Button>
              )}
              {(item.status === 'waiting' || item.status === 'failed') && (
                <Button variant="ghost" size="sm" onClick={() => onRemove(item.id)}>
                  Remove
                </Button>
              )}
            </div>

            {item.status === 'failed' && item.error && <p className="text-sm text-danger">{item.error}</p>}
          </li>
        ))}
      </ul>

      {rejected.length > 0 && (
        <Alert variant="warning">
          <ul className="flex flex-col gap-1">
            {rejected.map((r, index) => (
              <li key={index}>{r.fileName ? `${r.fileName}: ${r.reason}` : r.reason}</li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  )
}

export default BatchQueue
