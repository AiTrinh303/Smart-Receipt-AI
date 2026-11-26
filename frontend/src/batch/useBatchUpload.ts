import { useCallback, useEffect, useReducer, useRef } from 'react'
import { ApiError } from '../api/ApiError'
import { checkDuplicates as checkDuplicatesApi } from '../api/checkDuplicates'
import type { CheckDuplicatesResponse } from '../api/checkDuplicates'
import { extractReceipt } from '../api/extractReceipt'
import { uploadReceipt } from '../api/uploadReceipt'
import type { ReceiptSummary } from '../api/types'
import {
  EXTRACTION_FAILED_MESSAGE,
  EXTRACTION_NOT_CONFIGURED_MESSAGE,
  NETWORK_ERROR_MESSAGE,
} from '../errorMessages'
import { sha256Hex } from '../hash/sha256'
import { getExtension, isLikelyValidPdf, isValidFile } from '../fileValidation'
import {
  batchReducer,
  CONCURRENCY,
  INITIAL_BATCH_STATE,
  MAX_BATCH,
} from './batchReducer'
import type { BatchItem, BatchState, DuplicateCheckUpdate, RejectedFile } from './batchReducer'

const INVALID_TYPE_REASON = 'Invalid file type. Please select a JPG, PNG, or PDF file.'
const INVALID_PDF_REASON = 'This file does not look like a valid PDF.'
const DUPLICATE_REASON = 'duplicate'
const MAX_BATCH_REASON = `Only the first ${MAX_BATCH} files were added.`
const HASH_CONCURRENCY = 2

let nextItemId = 0
function createItemId(): string {
  nextItemId += 1
  return `batch-item-${nextItemId}`
}

function isSameFile(a: File, b: File): boolean {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified
}

/** Hashes `items` with at most `concurrency` files read at once -- the
 * same "a small, fixed number in flight" spirit as the upload/extract
 * scheduler, just for hashing. Returns a Map keyed by item id (so a null
 * hash, meaning "couldn't be computed," is still recorded as present). */
async function hashItems(
  items: BatchItem[],
  hasher: (file: File) => Promise<string | null>,
  concurrency: number,
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>()
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      const item = items[index]
      const hash = await hasher(item.file)
      results.set(item.id, hash)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  return results
}

export interface UseBatchUploadDeps {
  /** Defaults to sha256Hex. Injectable so tests never depend on a real
   * crypto.subtle implementation. */
  hasher?: (file: File) => Promise<string | null>
  /** Defaults to the real POST /receipts/check-duplicates call. Injectable
   * so tests can supply a fake without mocking fetch. */
  checkDuplicates?: (hashes: string[]) => Promise<CheckDuplicatesResponse>
}

export interface UseBatchUploadResult {
  items: BatchItem[]
  rejected: RejectedFile[]
  pausedReason: BatchState['pausedReason']
  running: boolean
  checkingDuplicates: boolean
  duplicateCheckFailed: boolean
  addFiles: (files: File[]) => Promise<void>
  start: (apartmentId: string) => void
  stop: () => void
  resume: () => void
  retry: (itemId: string) => void
  remove: (itemId: string) => void
  reset: () => void
  uploadAnyway: (itemId: string) => void
}

/** Drives the batch upload queue: addFiles() validates with the exact same
 * rules as the single-file flow, then a scheduler effect keeps at most
 * CONCURRENCY uploads+extracts in flight at once until the queue is
 * stopped, exhausted, or paused by a server/network failure. */
export function useBatchUpload(deps: UseBatchUploadDeps = {}): UseBatchUploadResult {
  const hasher = deps.hasher ?? sha256Hex
  const checkDuplicatesFn = deps.checkDuplicates ?? checkDuplicatesApi

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

  // Hashes the items just added (once, right after addFiles), flags any
  // whose hash already belongs to an earlier item in the queue (regardless
  // of which addFiles call added that earlier item) as "duplicate_in_batch"
  // without ever contacting the server, then sends the rest in one
  // check-duplicates call and flags a server match as "duplicate". Hashing
  // failures (hasher returns null) and a failed request are both handled
  // silently -- the only visible difference is duplicateCheckFailed, set
  // only for the latter, so the queue always continues as before either
  // way (the server itself still guards every upload).
  const runDuplicateCheck = useCallback(
    async (newItems: BatchItem[]) => {
      if (newItems.length === 0) {
        return
      }

      dispatch({ type: 'DUPLICATE_CHECK_START' })

      const hashes = await hashItems(newItems, hasher, HASH_CONCURRENCY)

      const knownHashes = new Set<string>()
      for (const item of stateRef.current.items) {
        if (item.hash) {
          knownHashes.add(item.hash)
        }
      }

      const updates: DuplicateCheckUpdate[] = []
      const toCheck: { id: string; hash: string }[] = []

      for (const item of newItems) {
        const hash = hashes.get(item.id) ?? null
        if (hash === null) {
          updates.push({ id: item.id, hash: null })
          continue
        }
        if (knownHashes.has(hash)) {
          updates.push({ id: item.id, hash, skipped: true, errorKind: 'duplicate_in_batch' })
          continue
        }
        knownHashes.add(hash)
        updates.push({ id: item.id, hash })
        toCheck.push({ id: item.id, hash })
      }

      if (toCheck.length === 0) {
        if (mountedRef.current) {
          dispatch({ type: 'DUPLICATE_CHECK_RESULT', failed: false, updates })
        }
        return
      }

      try {
        const response = await checkDuplicatesFn(toCheck.map((entry) => entry.hash))
        const existingByHash = new Map(response.items.map((entry) => [entry.hash, entry.existing]))
        const finalUpdates = updates.map((update) => {
          if (update.skipped || update.hash === null) {
            return update
          }
          const existing = existingByHash.get(update.hash) ?? null
          return existing ? { ...update, skipped: true, errorKind: 'duplicate' as const, existing } : update
        })
        if (!mountedRef.current) {
          return
        }
        dispatch({ type: 'DUPLICATE_CHECK_RESULT', failed: false, updates: finalUpdates })
      } catch {
        if (!mountedRef.current) {
          return
        }
        dispatch({ type: 'DUPLICATE_CHECK_RESULT', failed: true, updates })
      }
    },
    [hasher, checkDuplicatesFn],
  )

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
    await runDuplicateCheck(toAdd)
  }, [runDuplicateCheck])

  const processItem = useCallback(async (item: BatchItem, apartmentId: string) => {
    let receiptId = item.receiptId

    if (!receiptId) {
      dispatch({ type: 'ITEM_UPLOADING', id: item.id })
      try {
        const uploadResult = await uploadReceipt(item.file, apartmentId, item.allowDuplicate)
        receiptId = uploadResult.receipt_id
      } catch (err) {
        if (!mountedRef.current) {
          return
        }
        if (err instanceof ApiError && err.code === 'DUPLICATE_FILE') {
          // Safety net: the server itself caught a duplicate this app's own
          // pre-check missed (hashing was unavailable, the pre-check
          // request failed, or a second tab/device saved it meanwhile).
          // Never a failure, never pauses the queue.
          const existing = (err.details?.existing as ReceiptSummary | null | undefined) ?? null
          dispatch({ type: 'ITEM_SKIPPED', id: item.id, errorKind: 'duplicate', existing })
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

  const uploadAnyway = useCallback((itemId: string) => {
    dispatch({ type: 'UPLOAD_ANYWAY', id: itemId })
  }, [])

  return {
    items: state.items,
    rejected: state.rejected,
    pausedReason: state.pausedReason,
    running: state.running,
    checkingDuplicates: state.checkingDuplicates,
    duplicateCheckFailed: state.duplicateCheckFailed,
    addFiles,
    start,
    stop,
    resume,
    retry,
    remove,
    reset,
    uploadAnyway,
  }
}
