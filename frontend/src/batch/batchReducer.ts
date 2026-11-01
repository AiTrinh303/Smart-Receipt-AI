/** Pure state machine for the batch upload queue. No side effects, no API
 * calls -- those live in useBatchUpload.ts, which dispatches the actions
 * defined here as each upload/extract call settles. */

export const MAX_BATCH = 20
export const CONCURRENCY = 2

export type BatchItemStatus = 'waiting' | 'uploading' | 'reading' | 'done' | 'failed'

export type BatchErrorKind = 'upload' | 'unreadable' | 'unavailable' | 'network'

export type PausedReason = 'unavailable' | 'network' | 'stopped' | null

export interface BatchItem {
  id: string
  file: File
  status: BatchItemStatus
  receiptId?: string
  error?: string
  errorKind?: BatchErrorKind
  warningsCount?: number
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
}

export const INITIAL_BATCH_STATE: BatchState = {
  items: [],
  rejected: [],
  pausedReason: null,
  apartmentId: null,
  running: false,
}

export type BatchAction =
  | { type: 'ADD_FILES'; items: BatchItem[]; rejected: RejectedFile[] }
  | { type: 'START'; apartmentId: string }
  | { type: 'STOP' }
  | { type: 'RESUME' }
  | { type: 'ITEM_UPLOADING'; id: string }
  | { type: 'ITEM_READING'; id: string; receiptId: string }
  | { type: 'ITEM_DONE'; id: string; receiptId: string; warningsCount: number }
  | { type: 'ITEM_FAILED'; id: string; error: string; errorKind: BatchErrorKind; receiptId?: string }
  | {
      type: 'ITEM_FAILED_AND_PAUSE'
      id: string
      error: string
      errorKind: BatchErrorKind
      receiptId?: string
      pausedReason: 'unavailable' | 'network'
    }
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
      if (!target || (target.status !== 'waiting' && target.status !== 'failed')) {
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
