import { ApiError } from './ApiError'

const API_URL = import.meta.env.VITE_API_URL

export async function deleteReceipt(receiptId: string): Promise<void> {
  const response = await fetch(`${API_URL}/receipts/${receiptId}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.detail ?? 'Could not delete receipt.', response.status)
  }

  // A 204 has no body; nothing to parse on success.
}
