import { useEffect, useRef, useState } from 'react'
import Alert from '../components/ui/Alert'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'
import { formatFileSize } from '../components/ui/formatFileSize'
import { IMAGE_EXTENSIONS, getExtension } from '../fileValidation'
import type { BatchItem, BatchItemStatus, RejectedFile } from './batchReducer'

const STATUS_LABELS: Record<BatchItemStatus, string> = {
  waiting: 'Waiting',
  uploading: 'Uploading...',
  reading: 'Reading...',
  done: 'Done',
  failed: 'Failed',
}

function isImageFile(file: File): boolean {
  return IMAGE_EXTENSIONS.includes(getExtension(file.name))
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

function RemoveIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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

/** Keeps one object URL per queued IMAGE file, for the row thumbnails --
 * created lazily as items appear, revoked the moment an item's id drops out
 * of `items` (covers Remove, a whole-queue replace before starting, and
 * "Read more receipts"/reset, which all stop rendering the vanished items),
 * and all of them revoked again on unmount. Runs as an effect (not during
 * render) so createObjectURL/revokeObjectURL are side effects React can
 * account for, and only touches the map when ids actually change -- a
 * status update on an existing item never churns its thumbnail. */
function useThumbnails(items: BatchItem[]): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const urlsRef = useRef(urls)
  urlsRef.current = urls

  useEffect(() => {
    setUrls((prev) => {
      const next = new Map(prev)
      let changed = false
      const currentIds = new Set(items.map((item) => item.id))

      for (const item of items) {
        if (!next.has(item.id) && isImageFile(item.file)) {
          next.set(item.id, URL.createObjectURL(item.file))
          changed = true
        }
      }
      for (const [id, url] of prev) {
        if (!currentIds.has(id)) {
          URL.revokeObjectURL(url)
          next.delete(id)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [items])

  useEffect(() => {
    return () => {
      for (const url of urlsRef.current.values()) {
        URL.revokeObjectURL(url)
      }
    }
  }, [])

  return urls
}

function BatchQueue({ items, rejected, onRetry, onRemove }: BatchQueueProps) {
  const thumbnails = useThumbnails(items)

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {items.map((item) => {
          const thumbnailUrl = thumbnails.get(item.id)
          return (
            <li key={item.id} className="rounded-md border border-border bg-surface-page">
              <div className="flex items-center gap-3 px-3 py-2">
                {thumbnailUrl ? (
                  <img
                    src={thumbnailUrl}
                    alt=""
                    className="h-10 w-10 flex-shrink-0 rounded border border-border bg-slate-100 object-contain"
                  />
                ) : (
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded border border-border bg-slate-100">
                    <FileIcon />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink" title={item.file.name}>
                    {item.file.name}
                  </p>
                  <p className="text-xs text-ink-muted">{formatFileSize(item.file.size)}</p>
                </div>
                <StatusChip status={item.status} />
                {(item.status === 'waiting' || item.status === 'failed') && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${item.file.name}`}
                    onClick={() => onRemove(item.id)}
                  >
                    <RemoveIcon />
                  </Button>
                )}
              </div>

              {item.status === 'done' && (item.receiptId || (item.warningsCount ?? 0) > 0) && (
                <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
                  {item.receiptId && (
                    <a
                      href={`/?receipt=${item.receiptId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-brand underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    >
                      Open
                    </a>
                  )}
                  {(item.warningsCount ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
                      Check values ({item.warningsCount})
                    </span>
                  )}
                </div>
              )}

              {item.status === 'failed' && (
                <div className="flex flex-col gap-2 px-3 pb-2">
                  {item.error && <p className="text-sm text-danger">{item.error}</p>}
                  <Button variant="secondary" size="sm" className="self-start" onClick={() => onRetry(item.id)}>
                    Retry
                  </Button>
                </div>
              )}
            </li>
          )
        })}
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
