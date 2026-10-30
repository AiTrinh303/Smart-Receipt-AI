import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { ApiError } from './api/ApiError'
import { updateReceiptCategory } from './api/updateReceiptCategory'
import { updateReceiptStatus } from './api/updateReceiptStatus'
import type { SavedReceipt } from './api/getReceipt'
import type { ReceiptStatus } from './api/types'
import { useCategories } from './hooks/useCategories'
import Alert from './components/ui/Alert'
import Button from './components/ui/Button'
import Skeleton from './components/ui/Skeleton'
import StatusBadge from './components/ui/StatusBadge'

interface ReceiptClassificationProps {
  receiptId: string
  categoryId: string | null
  status: ReceiptStatus
  onUpdated: (updated: SavedReceipt) => void
}

const NETWORK_ERROR_MESSAGE = 'Could not reach the server. Please try again.'
const CATEGORY_SELECT_ID = 'receipt-category-select'
const CHOOSE_CATEGORY_LABEL = 'Choose a category'

const MISSING_FIELD_LABELS: Record<string, string> = {
  apartment: 'apartment',
  category: 'category',
  date: 'a valid purchase date',
  total: 'total',
}

function describeMissing(missing: string[]): string {
  const labels = missing.map((code) => MISSING_FIELD_LABELS[code] ?? code)
  const message = `To approve this receipt, also set: ${labels.join(', ')}.`
  return missing.includes('date') ? `${message} You can fix the date with Edit.` : message
}

/** Shown on the saved-receipt view next to ReceiptApartment -- never inside
 * ReceiptResult itself -- and hidden while the edit form is open. Lets the
 * category and review status be changed independently of editing the
 * receipt's data, via PUT /receipts/{id}/category and
 * PUT /receipts/{id}/status. Never calls extract or the plain
 * PUT /receipts/{id}. */
function ReceiptClassification({ receiptId, categoryId, status, onUpdated }: ReceiptClassificationProps) {
  const { categories, isLoading, error: loadError, retry } = useCategories(true)
  const [selectedCategory, setSelectedCategory] = useState(categoryId ?? '')
  const [isSavingCategory, setIsSavingCategory] = useState(false)
  const [categoryError, setCategoryError] = useState<string | null>(null)
  const [justSavedCategory, setJustSavedCategory] = useState(false)

  const [isSavingStatus, setIsSavingStatus] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)

  // The displayed selection always reflects the receipt's actual stored
  // category -- including when it changes for a reason outside this
  // component's own save flow.
  useEffect(() => {
    setSelectedCategory(categoryId ?? '')
  }, [categoryId])

  const handleCategoryChange = async (event: ChangeEvent<HTMLSelectElement>) => {
    const newCategoryId = event.target.value
    const previous = selectedCategory
    setSelectedCategory(newCategoryId)
    setCategoryError(null)
    setJustSavedCategory(false)
    setIsSavingCategory(true)

    try {
      const updated = await updateReceiptCategory(receiptId, newCategoryId)
      onUpdated(updated)
      setJustSavedCategory(true)
    } catch (err) {
      setSelectedCategory(previous)
      setCategoryError(err instanceof ApiError ? err.message : NETWORK_ERROR_MESSAGE)
    } finally {
      setIsSavingCategory(false)
    }
  }

  const handleStatusChange = async (newStatus: ReceiptStatus) => {
    setStatusError(null)
    setIsSavingStatus(true)

    try {
      const updated = await updateReceiptStatus(receiptId, newStatus)
      onUpdated(updated)
    } catch (err) {
      if (err instanceof ApiError && err.missing && err.missing.length > 0) {
        setStatusError(describeMissing(err.missing))
      } else {
        setStatusError(err instanceof ApiError ? err.message : NETWORK_ERROR_MESSAGE)
      }
    } finally {
      setIsSavingStatus(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor={CATEGORY_SELECT_ID} className="text-sm font-medium text-ink">
          Category
        </label>
        {loadError ? (
          <div className="flex flex-col gap-2">
            <Alert variant="error">{loadError}</Alert>
            <Button variant="secondary" size="sm" className="self-start" onClick={retry}>
              Retry
            </Button>
          </div>
        ) : isLoading || !categories ? (
          <div role="status" aria-busy="true" className="flex flex-col gap-2">
            <span className="text-sm text-ink-muted">Loading categories...</span>
            <Skeleton className="h-11 w-full" />
          </div>
        ) : (
          <>
            <select
              id={CATEGORY_SELECT_ID}
              value={selectedCategory}
              onChange={handleCategoryChange}
              disabled={isSavingCategory}
              className="h-11 min-h-[44px] rounded-md border border-border bg-surface px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              <option value="">{CHOOSE_CATEGORY_LABEL}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            {isSavingCategory && <p className="text-sm text-ink-muted">Saving...</p>}
            {!isSavingCategory && justSavedCategory && (
              <p role="status" className="text-sm text-success">
                Saved
              </p>
            )}
            {categoryError && <Alert variant="error">{categoryError}</Alert>}
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-ink">Status</span>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={status} />
          {status === 'needs_review' ? (
            <Button
              variant="primary"
              size="sm"
              disabled={isSavingStatus}
              onClick={() => handleStatusChange('approved')}
            >
              Mark as approved
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled={isSavingStatus}
              onClick={() => handleStatusChange('needs_review')}
            >
              Back to needs review
            </Button>
          )}
        </div>
        {isSavingStatus && <p className="text-sm text-ink-muted">Saving...</p>}
        {statusError && <Alert variant="error">{statusError}</Alert>}
      </div>
    </div>
  )
}

export default ReceiptClassification
