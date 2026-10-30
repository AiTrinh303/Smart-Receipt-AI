import { ApiError } from './ApiError'
import type { SavedReceipt } from './getReceipt'

const API_URL = import.meta.env.VITE_API_URL

export async function updateReceiptCategory(
  receiptId: string,
  categoryId: string,
): Promise<SavedReceipt> {
  const response = await fetch(`${API_URL}/receipts/${receiptId}/category`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category_id: categoryId }),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.detail ?? 'Could not update the category.', response.status)
  }

  return response.json()
}
