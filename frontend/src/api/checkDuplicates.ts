import { apiErrorFromDetail } from './ApiError'
import type { ReceiptSummary } from './types'

export interface CheckDuplicatesItem {
  hash: string
  existing: ReceiptSummary | null
}

export interface CheckDuplicatesResponse {
  items: CheckDuplicatesItem[]
}

const API_URL = import.meta.env.VITE_API_URL

/** POST /receipts/check-duplicates: given up to 50 lowercase SHA-256 hex
 * hashes, returns which ones already match a saved receipt, in request
 * order. Never called with more than MAX_BATCH (20) hashes by this app, so
 * the backend's own 50-entry cap is never hit from here. */
export async function checkDuplicates(hashes: string[]): Promise<CheckDuplicatesResponse> {
  const response = await fetch(`${API_URL}/receipts/check-duplicates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hashes }),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw apiErrorFromDetail(body?.detail, response.status, 'Could not check for duplicates.')
  }

  return response.json()
}
