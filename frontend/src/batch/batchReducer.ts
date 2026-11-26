/** Pure state machine for the batch upload queue. No side effects, no API
 * calls -- those live in useBatchUpload.ts, which dispatches the actions
 * defined here as each upload/extract call settles. */

import type { ReceiptSummary } from '../api/types'

export const MAX_BATCH = 20
export const CONCURRENCY = 2

export type BatchItemStatus = 'waiting' | 'uploading' | 'reading' | 'done' | 'failed' | 'skipped'

export type BatchErrorKind = 'upload' | 'unreadable' | 'unavailable' | 'network' | 'duplicate' | 'duplicate_in_batch'

export type PausedReason = 'unavailable' | 'network' | 'stopped' | null

export interface BatchItem {
  id: string
  file: File
  status: BatchItemStatus
  receiptId?: string
  error?: string
  errorKind?: BatchErrorKind
  warningsCount?: number
  /** Set only when the item is "done". */
  extracted?: ExtractedSummary
  /** This file's content hash (null when it couldn't be computed), set
   * once the duplicate check has run for it -- used to catch a second,
   * byte-identical file added later in the same session. */
  hash?: string | null
  /** The already-saved receipt a "skipped" item (errorKind "duplicate")
   * matched -- null for "duplicate_in_batch" (no saved receipt involved,
   * just another file already in this queue). */
  existing?: ReceiptSummary | null
  /** Set by "Upload anyway": the next upload attempt for this item sends
   * allow_duplicate=true. Survives a later retry/resume. */
  allowDuplicate?: boolean
}

/** What the AI read for a done item -- kept from the extract response so
 * the queue row can show it without another request. Every field is
 * nullable, exactly as the extract response's own. */
export interface ExtractedSummary {
  store_name: string | null
  purchase_date: string | null
  total: number | null
  currency: string | null
}

export interface RejectedFile {
  fileName: string
  reason: string
}

export interface BatchState {
  items: BatchItem[]
  rejected: RejectedFile[]
  pausedReason: PausedReason
  apartmentId: string | null
  running: boolean
  /** True only while the one-shot post-addFiles duplicate check (hashing
   * + at most one check-duplicates request) is in flight. */
  checkingDuplicates: boolean
  /** True when the last duplicate check's check-duplicates request itself
   * failed (never set just because hashing was unavailable) -- cleared the
   * moment a new check starts. */
  duplicateCheckFailed: boolean
}

export const INITIAL_BATCH_STATE: BatchState = {
  items: [],
  rejected: [],
  pausedReason: null,
  apartmentId: null,
  running: false,
  checkingDuplicates: false,
  duplicateCheckFailed: false,
}

export interface DuplicateCheckUpdate {
  id: string
  hash: string | null
  skipped?: boolean
  errorKind?: 'duplicate' | 'duplicate_in_batch'
  existing?: ReceiptSummary | null
}

export type BatchAction =
  | { type: 'ADD_FILES'; items: BatchItem[]; rejected: RejectedFile[] }
  | { type: 'START'; apartmentId: string }
  | { type: 'STOP' }
  | { type: 'RESUME' }
  | { type: 'ITEM_UPLOADING'; id: string }
  | { type: 'ITEM_READING'; id: string; receiptId: string }
  | { type: 'ITEM_DONE'; id: string; receiptId: string; warningsCount: number; extracted: ExtractedSummary }
  | { type: 'ITEM_FAILED'; id: string; error: string; errorKind: BatchErrorKind; receiptId?: string }
  | {
      type: 'ITEM_FAILED_AND_PAUSE'
      id: string
      error: string
      errorKind: BatchErrorKind
      receiptId?: string
      pausedReason: 'unavailable' | 'network'
    }
  | { type: 'ITEM_SKIPPED'; id: string; errorKind: 'duplicate'; existing: ReceiptSummary | null }
  | { type: 'UPLOAD_ANYWAY'; id: string }
  | { type: 'DUPLICATE_CHECK_START' }
  | { type: 'DUPLICATE_CHECK_RESULT'; failed: boolean; updates: DuplicateCheckUpdate[] }
  | { type: 'RETRY'; id: string }
  | { type: 'REMOVE'; id: string }
  | { type: 'RESET' }

function updateItem(
  items: BatchItem[],
  id: string,
  update: (item: BatchItem) => BatchItem,
): BatchItem[] {
  return items.map((item) => (item.id === id ? update(item) : item))
}

export function batchReducer(state: BatchState, action: BatchAction): BatchState {
  switch (action.type) {
    case 'ADD_FILES': {
      // Replaces the current queue when nothing is running (e.g. picking
      // files again before starting); while running, new files are added
      // alongside whatever is already in flight or queued.
      if (!state.running) {
        return { ...state, items: action.items, rejected: action.rejected }
      }
      return {
        ...state,
        items: [...state.items, ...action.items],
        rejected: [...state.rejected, ...action.rejected],
      }
    }

    case 'START':
      return { ...state, running: true, pausedReason: null, apartmentId: action.apartmentId }

    case 'STOP':
      return { ...state, pausedReason: 'stopped' }

    case 'RESUME':
      return { ...state, pausedReason: null }

    case 'ITEM_UPLOADING':
      return {
        ...state,
        items: updateItem(state.items, action.id, (item) => ({
          ...item,
          status: 'uploading',
          error: undefined,
          errorKind: undefined,
        })),
      }

    case 'ITEM_READING':
      return {
        ...state,
        items: updateItem(state.items, action.id, (item) => ({
          ...item,
          status: 'reading',
          receiptId: action.receiptId,
          error: undefined,
          errorKind: undefined,
        })),
      }

    case 'ITEM_DONE':
      return {
        ...state,
        items: updateItem(state.items, action.id, (item) => ({
          ...item,
          status: 'done',
          receiptId: action.receiptId,
          warningsCount: action.warningsCount,
          extracted: action.extracted,
          error: undefined,
          errorKind: undefined,
        })),
      }

    case 'ITEM_FAILED':
      return {
        ...state,
        items: updateItem(state.items, action.id, (item) => ({
          ...item,
          status: 'failed',
          error: action.error,
          errorKind: action.errorKind,
          receiptId: action.receiptId ?? item.receiptId,
        })),
      }

    case 'ITEM_FAILED_AND_PAUSE':
      return {
        ...state,
        pausedReason: action.pausedReason,
        items: updateItem(state.items, action.id, (item) => ({
          ...item,
          status: 'failed',
          error: action.error,
          errorKind: action.errorKind,
          receiptId: action.receiptId ?? item.receiptId,
        })),
      }

    case 'ITEM_SKIPPED':
      // The 409 DUPLICATE_FILE safety net: the server itself flagged this
      // file as already saved during the upload call. Never a failure, and
      // never pauses the queue -- the rest of the batch keeps going.
      return {
        ...state,
        items: updateItem(state.items, action.id, (item) => ({
          ...item,
          status: 'skipped',
          errorKind: action.errorKind,
          existing: action.existing,
          error: undefined,
        })),
      }

    case 'UPLOAD_ANYWAY': {
      const target = state.items.find((item) => item.id === action.id)
      if (!target || target.status !== 'skipped') {
        return state
      }
      return {
        ...state,
        items: updateItem(state.items, action.id, (item) => ({
          ...item,
          status: 'waiting',
          allowDuplicate: true,
          error: undefined,
          errorKind: undefined,
        })),
      }
    }

    case 'DUPLICATE_CHECK_START':
      return { ...state, checkingDuplicates: true, duplicateCheckFailed: false }

    case 'DUPLICATE_CHECK_RESULT': {
      const updatesById = new Map(action.updates.map((update) => [update.id, update]))
      return {
        ...state,
        checkingDuplicates: false,
        duplicateCheckFailed: action.failed,
        items: state.items.map((item) => {
          const update = updatesById.get(item.id)
          if (!update) {
            return item
          }
          if (update.skipped) {
            return {
              ...item,
              status: 'skipped',
              errorKind: update.errorKind,
              hash: update.hash,
              existing: update.existing ?? null,
            }
          }
          return { ...item, hash: update.hash }
        }),
      }
    }

    case 'RETRY': {
      // Goes back to the end of the processing order -- removed from its
      // current position and re-appended, status reset to "waiting" (kept
      // receiptId, if any, so a retry with one skips straight to extract).
      const target = state.items.find((item) => item.id === action.id)
      if (!target) {
        return state
      }
      const rest = state.items.filter((item) => item.id !== action.id)
      return {
        ...state,
        items: [...rest, { ...target, status: 'waiting', error: undefined, errorKind: undefined }],
      }
    }

    case 'REMOVE': {
      const target = state.items.find((item) => item.id === action.id)
      if (
        !target ||
        (target.status !== 'waiting' && target.status !== 'failed' && target.status !== 'skipped')
      ) {
        return state
      }
      return { ...state, items: state.items.filter((item) => item.id !== action.id) }
    }

    case 'RESET': {
      const anyInFlight = state.items.some(
        (item) => item.status === 'uploading' || item.status === 'reading',
      )
      if (anyInFlight) {
        return state
      }
      return { ...INITIAL_BATCH_STATE }
    }

    default:
      return state
  }
}
