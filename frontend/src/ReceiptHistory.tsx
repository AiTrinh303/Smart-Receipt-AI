import { useEffect, useState } from 'react'
import { ApiError } from './api/ApiError'
import { listReceipts } from './api/listReceipts'
import type { ReceiptSummary } from './api/types'
import { navigateTo } from './navigation'

const NOT_DETECTED = 'Not detected'

function displayText(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? NOT_DETECTED : value
}

function displayAmount(value: number | null | undefined, currency: string | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return NOT_DETECTED
  }

  const formatted = value.toFixed(2)
  return currency ? `${currency} ${formatted}` : formatted
}

const NETWORK_ERROR_MESSAGE = 'Could not reach the server. Please try again.'
const LIST_FAILED_MESSAGE = 'Could not load receipt history. Please try again.'

function ReceiptHistory() {
  const [items, setItems] = useState<ReceiptSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const load = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await listReceipts()
      setItems(response.items)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(LIST_FAILED_MESSAGE)
      } else {
        setError(NETWORK_ERROR_MESSAGE)
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    load()
    // Only ever run once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openReceipt = (receiptId: string) => {
    navigateTo(`?receipt=${receiptId}`)
  }

  const goToUpload = (e: React.MouseEvent) => {
    e.preventDefault()
    navigateTo('')
  }

  if (isLoading) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4 rounded-lg border border-gray-300 p-6">
        <p className="text-sm text-gray-600">Loading receipts...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4 rounded-lg border border-gray-300 p-6">
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
        <button
          type="button"
          onClick={load}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
        >
          Retry
        </button>
      </div>
    )
  }

  if (items && items.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4 rounded-lg border border-gray-300 p-6">
        <p className="text-sm text-gray-600">No receipts yet. Upload your first receipt.</p>
        <a
          href="/"
          onClick={goToUpload}
          className="text-sm font-medium text-blue-600 underline"
        >
          Upload a receipt
        </a>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 rounded-lg border border-gray-300 p-6">
      <h2 className="text-lg font-semibold text-gray-900">Receipt history</h2>
      <ul className="flex flex-col gap-2">
        {items?.map((item) => (
          <li key={item.receipt_id}>
            <button
              type="button"
              onClick={() => openReceipt(item.receipt_id)}
              className="flex w-full items-center justify-between gap-4 rounded border border-gray-200 px-3 py-2 text-left text-sm hover:bg-gray-50"
            >
              <span>
                <span className="block font-medium text-gray-900">
                  {displayText(item.store_name)}
                </span>
                <span className="block text-gray-500">{displayText(item.purchase_date)}</span>
              </span>
              <span className="font-semibold text-gray-900">
                {displayAmount(item.total, item.currency)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default ReceiptHistory
