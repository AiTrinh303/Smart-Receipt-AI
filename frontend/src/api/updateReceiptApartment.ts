import { ApiError } from './ApiError'
import type { SavedReceipt } from './getReceipt'

const API_URL = import.meta.env.VITE_API_URL

export async function updateReceiptApartment(
  receiptId: string,
  apartmentId: string,
): Promise<SavedReceipt> {
  const response = await fetch(`${API_URL}/receipts/${receiptId}/apartment`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apartment_id: apartmentId }),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.detail ?? 'Could not update the apartment.', response.status)
  }

  return response.json()
}
