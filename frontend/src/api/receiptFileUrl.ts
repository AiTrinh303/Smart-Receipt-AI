const API_URL = import.meta.env.VITE_API_URL

export function receiptFileUrl(receiptId: string): string {
  return `${API_URL}/receipts/${encodeURIComponent(receiptId)}/file`
}
