import { useCallback, useEffect, useReducer, useRef } from 'react'
import { ApiError } from '../api/ApiError'
import { extractReceipt } from '../api/extractReceipt'
import { uploadReceipt } from '../api/uploadReceipt'
import {
  EXTRACTION_FAILED_MESSAGE,
  EXTRACTION_NOT_CONFIGURED_MESSAGE,
  NETWORK_ERROR_MESSAGE,
} from '../errorMessages'
import { getExtension, isLikelyValidPdf, isValidFile } from '../fileValidation'
import {
  batchReducer,
  CONCURRENCY,
  INITIAL_BATCH_STATE,
  MAX_BATCH,
} from './batchReducer'
import type { BatchItem, BatchState, RejectedFile } from './batchReducer'

const INVALID_TYPE_REASON = 'Invalid file type. Please select a JPG, PNG, or PDF file.'
const INVALID_PDF_REASON = 'This file does not look like a valid PDF.'
const DUPLICATE_REASON = 'duplicate'
const MAX_BATCH_REASON = `Only the first ${MAX_BATCH} files were added.`

let nextItemId = 0
function createItemId(): string {
  nextItemId += 1
  return `batch-item-${nextItemId}`
}

function isSameFile(a: File, b: File): boolean {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified
}

export interface UseBatchUploadResult {
  items: BatchItem[]
  rejected: RejectedFile[]
  pausedReason: BatchState['pausedReason']
  running: boolean
  addFiles: (files: File[]) => Promise<void>
  start: (apartmentId: string) => void
  stop: () => void
  resume: () => void
  retry: (itemId: string) => void
  remove: (itemId: string) => void
  reset: () => void
}

/** Drives the batch upload queue: addFiles() validates with the exact same
 * rules as the single-file flow, then a scheduler effect keeps at most
 * CONCURRENCY uploads+extracts in flight at once until the queue is
 * stopped, exhausted, or paused by a server/network failure. */
export function useBatchUpload(): UseBatchUploadResult {
  const [state, dispatch] = useReducer(batchReducer, INITIAL_BATCH_STATE)

  // addFiles() needs the latest queue (for duplicate-checking and the
  // running/not-running replace-vs-append decision) without re-creating
  // the callback on every state change, and without risking a stale
  // closure -- a ref kept in sync on every render covers both.
  const stateRef = useRef(state)
  stateRef.current = state

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const addFiles = useCallback(async (files: File[]) => {
    const current = stateRef.current
    const existingFiles = current.items.map((item) => item.file)
    const accepted: BatchItem[] = []
    const rejected: RejectedFile[] = []

    for (const file of files) {
      if (!isValidFile(file)) {
        rejected.push({ fileName: file.name, reason: INVALID_TYPE_REASON })
        continue
      }

      const extension = getExtension(file.name)
      if (extension === '.pdf' && !(await isLikelyValidPdf(file))) {
        rejected.push({ fileName: file.name, reason: INVALID_PDF_REASON })
        continue
      }

      const isDuplicate =
        existingFiles.some((existing) => isSameFile(existing, file)) ||
        accepted.some((item) => isSameFile(item.file, file))
      if (isDuplicate) {
        rejected.push({ fileName: file.name, reason: DUPLICATE_REASON })
        continue
      }

      accepted.push({ id: createItemId(), file, status: 'waiting' })
    }

    let toAdd = accepted
    if (toAdd.length > MAX_BATCH) {
      toAdd = toAdd.slice(0, MAX_BATCH)
      rejected.push({ fileName: '', reason: MAX_BATCH_REASON })
    }

    if (!mountedRef.current) {
      return
    }

    dispatch({ type: 'ADD_FILES', items: toAdd, rejected })
  }, [])

  const processItem = useCallback(async (item: BatchItem, apartmentId: string) => {
    let receiptId = item.receiptId

    if (!receiptId) {
      dispatch({ type: 'ITEM_UPLOADING', id: item.id })
      try {
        const uploadResult = await uploadReceipt(item.file, apartmentId)
        receiptId = uploadResult.receipt_id
      } catch (err) {
        if (!mountedRef.current) {
          return
        }
        if (err instanceof ApiError) {
          dispatch({ type: 'ITEM_FAILED', id: item.id, error: err.message, errorKind: 'upload' })
        } else {
          dispatch({
            type: 'ITEM_FAILED_AND_PAUSE',
            id: item.id,
            error: NETWORK_ERROR_MESSAGE,
            errorKind: 'network',
            pausedReason: 'network',
          })
        }
        return
      }
    }

    if (!mountedRef.current) {
      return
    }
    dispatch({ type: 'ITEM_READING', id: item.id, receiptId })

    try {
      const extractResult = await extractReceipt(receiptId)
      if (!mountedRef.current) {
        return
      }
      dispatch({
        type: 'ITEM_DONE',
        id: item.id,
        receiptId,
        warningsCount: extractResult.warnings.length,
      })
    } catch (err) {
      if (!mountedRef.current) {
        return
      }
      if (err instanceof ApiError && err.status === 503) {
        dispatch({
          type: 'ITEM_FAILED_AND_PAUSE',
          id: item.id,
          error: EXTRACTION_NOT_CONFIGURED_MESSAGE,
          errorKind: 'unavailable',
          receiptId,
          pausedReason: 'unavailable',
        })
      } else if (err instanceof ApiError) {
        // A 502 (unreadable receipt), or any other server status: this one
        // item fails, the rest of the queue keeps going.
        dispatch({
          type: 'ITEM_FAILED',
          id: item.id,
          error: EXTRACTION_FAILED_MESSAGE,
          errorKind: 'unreadable',
          receiptId,
        })
      } else {
        dispatch({
          type: 'ITEM_FAILED_AND_PAUSE',
          id: item.id,
          error: NETWORK_ERROR_MESSAGE,
          errorKind: 'network',
          receiptId,
          pausedReason: 'network',
        })
      }
    }
  }, [])

  // The scheduler: re-evaluated after every state change, starts as many
  // "waiting" items as there is room for (CONCURRENCY minus whatever is
  // already uploading/reading), and does nothing at all -- not even
  // counting slots -- once paused or stopped, so in-flight items simply
  // finish on their own and nothing new ever starts.
  useEffect(() => {
    if (!state.running || state.pausedReason !== null || !state.apartmentId) {
      return
    }

    const inFlightCount = state.items.filter(
      (item) => item.status === 'uploading' || item.status === 'reading',
    ).length
    const availableSlots = CONCURRENCY - inFlightCount
    if (availableSlots <= 0) {
      return
    }

    const toStart = state.items.filter((item) => item.status === 'waiting').slice(0, availableSlots)
    for (const item of toStart) {
      processItem(item, state.apartmentId)
    }
  }, [state.items, state.running, state.pausedReason, state.apartmentId, processItem])

  const start = useCallback((apartmentId: string) => {
    dispatch({ type: 'START', apartmentId })
  }, [])

  const stop = useCallback(() => {
    dispatch({ type: 'STOP' })
  }, [])

  const resume = useCallback(() => {
    dispatch({ type: 'RESUME' })
  }, [])

  const retry = useCallback((itemId: string) => {
    dispatch({ type: 'RETRY', id: itemId })
  }, [])

  const remove = useCallback((itemId: string) => {
    dispatch({ type: 'REMOVE', id: itemId })
  }, [])

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' })
  }, [])

  return {
    items: state.items,
    rejected: state.rejected,
    pausedReason: state.pausedReason,
    running: state.running,
    addFiles,
    start,
    stop,
    resume,
    retry,
    remove,
    reset,
  }
}
