import { useState } from 'react'
import { ApiError } from './api/ApiError'
import { updateReceipt } from './api/updateReceipt'
import type { ReceiptEditableAmount, ReceiptEditableFields, ReceiptEditableItem } from './api/updateReceipt'
import type { ReceiptExtraction } from './api/types'

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const NETWORK_ERROR_MESSAGE = 'Could not reach the server. Please try again.'

interface ItemRow {
  name: string
  quantity: string
  unit_price: string
  line_total: string
}

interface AmountRow {
  description: string
  amount: string
}

function numberToInput(value: number | null): string {
  return value === null ? '' : String(value)
}

function itemToRow(item: ReceiptExtraction['items'][number]): ItemRow {
  return {
    name: item.name ?? '',
    quantity: numberToInput(item.quantity),
    unit_price: numberToInput(item.unit_price),
    line_total: numberToInput(item.line_total),
  }
}

function amountToRow(entry: { description: string | null; amount: number | null }): AmountRow {
  return {
    description: entry.description ?? '',
    amount: numberToInput(entry.amount),
  }
}

function parseOptionalNumber(text: string): { value: number | null; error?: string } {
  const trimmed = text.trim()
  if (trimmed === '') {
    return { value: null }
  }
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) {
    return { value: null, error: 'Must be a number.' }
  }
  return { value: parsed }
}

interface ReceiptEditFormProps {
  receiptId: string
  data: ReceiptExtraction
  onSave: (updated: ReceiptExtraction) => void
  onCancel: () => void
}

function ReceiptEditForm({ receiptId, data, onSave, onCancel }: ReceiptEditFormProps) {
  const [storeName, setStoreName] = useState(data.store_name ?? '')
  const [purchaseDate, setPurchaseDate] = useState(data.purchase_date ?? '')
  const [currency, setCurrency] = useState(data.currency ?? '')
  const [items, setItems] = useState<ItemRow[]>(data.items.map(itemToRow))
  const [discounts, setDiscounts] = useState<AmountRow[]>(data.discounts.map(amountToRow))
  const [taxes, setTaxes] = useState<AmountRow[]>(data.taxes.map(amountToRow))
  const [total, setTotal] = useState(numberToInput(data.total))

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const originalDate = data.purchase_date
  const isOriginalDateIso = originalDate === null || ISO_DATE_PATTERN.test(originalDate)

  const updateItem = (index: number, field: keyof ItemRow, value: string) => {
    setItems((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)))
  }

  const updateDiscount = (index: number, field: keyof AmountRow, value: string) => {
    setDiscounts((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)))
  }

  const updateTax = (index: number, field: keyof AmountRow, value: string) => {
    setTaxes((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)))
  }

  const addItem = () => setItems((prev) => [...prev, { name: '', quantity: '', unit_price: '', line_total: '' }])
  const removeItem = (index: number) => setItems((prev) => prev.filter((_, i) => i !== index))

  const addDiscount = () => setDiscounts((prev) => [...prev, { description: '', amount: '' }])
  const removeDiscount = (index: number) => setDiscounts((prev) => prev.filter((_, i) => i !== index))

  const addTax = () => setTaxes((prev) => [...prev, { description: '', amount: '' }])
  const removeTax = (index: number) => setTaxes((prev) => prev.filter((_, i) => i !== index))

  const handleSave = async () => {
    const errors: Record<string, string> = {}
    const parsedItems: ReceiptEditableItem[] = items.map((row, index) => {
      const quantity = parseOptionalNumber(row.quantity)
      const unitPrice = parseOptionalNumber(row.unit_price)
      const lineTotal = parseOptionalNumber(row.line_total)
      if (quantity.error) errors[`item-${index}-quantity`] = quantity.error
      if (unitPrice.error) errors[`item-${index}-unit_price`] = unitPrice.error
      if (lineTotal.error) errors[`item-${index}-line_total`] = lineTotal.error
      return {
        name: row.name,
        quantity: quantity.value,
        unit_price: unitPrice.value,
        line_total: lineTotal.value,
      }
    })

    const parsedDiscounts: ReceiptEditableAmount[] = discounts.map((row, index) => {
      const amount = parseOptionalNumber(row.amount)
      if (amount.error) errors[`discount-${index}-amount`] = amount.error
      return { description: row.description, amount: amount.value }
    })

    const parsedTaxes: ReceiptEditableAmount[] = taxes.map((row, index) => {
      const amount = parseOptionalNumber(row.amount)
      if (amount.error) errors[`tax-${index}-amount`] = amount.error
      return { description: row.description, amount: amount.value }
    })

    const parsedTotal = parseOptionalNumber(total)
    if (parsedTotal.error) errors.total = parsedTotal.error

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }

    setFieldErrors({})
    setSaveError(null)
    setIsSaving(true)

    const fields: ReceiptEditableFields = {
      store_name: storeName.trim() === '' ? null : storeName,
      purchase_date: purchaseDate.trim() === '' ? null : purchaseDate,
      currency: currency.trim() === '' ? null : currency,
      items: parsedItems,
      discounts: parsedDiscounts,
      taxes: parsedTaxes,
      total: parsedTotal.value,
    }

    try {
      const updated = await updateReceipt(receiptId, fields)
      onSave(updated)
    } catch (err) {
      if (err instanceof ApiError) {
        setSaveError(err.message)
      } else {
        setSaveError(NETWORK_ERROR_MESSAGE)
      }
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 rounded-lg border border-gray-300 p-6">
      <h2 className="text-lg font-semibold text-gray-900">Edit receipt</h2>

      {saveError && (
        <p role="alert" className="text-sm text-red-600">
          {saveError}
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm text-gray-700">
        Store name
        <input
          type="text"
          value={storeName}
          onChange={(e) => setStoreName(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-gray-700">
        Purchase date
        {isOriginalDateIso ? (
          <input
            type="date"
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
        ) : (
          <>
            <input
              type="text"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              placeholder="YYYY-MM-DD"
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            />
            <span className="text-xs text-gray-500">Original: {originalDate}</span>
          </>
        )}
      </label>

      <label className="flex flex-col gap-1 text-sm text-gray-700">
        Currency
        <input
          type="text"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </label>

      <div>
        <h3 className="mb-1 text-sm font-medium text-gray-700">Items</h3>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-gray-500">
              <th className="py-1 pr-1 font-medium">Name</th>
              <th className="py-1 pr-1 font-medium">Qty</th>
              <th className="py-1 pr-1 font-medium">Unit price</th>
              <th className="py-1 pr-1 font-medium">Line total</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {items.map((row, index) => (
              <tr key={index}>
                <td className="py-1 pr-1">
                  <input
                    type="text"
                    value={row.name}
                    onChange={(e) => updateItem(index, 'name', e.target.value)}
                    aria-label={`Item ${index + 1} name`}
                    className="w-full rounded border border-gray-300 px-1 py-0.5 text-sm"
                  />
                </td>
                <td className="py-1 pr-1">
                  <input
                    type="text"
                    value={row.quantity}
                    onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                    aria-label={`Item ${index + 1} quantity`}
                    className="w-16 rounded border border-gray-300 px-1 py-0.5 text-sm"
                  />
                  {fieldErrors[`item-${index}-quantity`] && (
                    <p role="alert" className="text-xs text-red-600">
                      {fieldErrors[`item-${index}-quantity`]}
                    </p>
                  )}
                </td>
                <td className="py-1 pr-1">
                  <input
                    type="text"
                    value={row.unit_price}
                    onChange={(e) => updateItem(index, 'unit_price', e.target.value)}
                    aria-label={`Item ${index + 1} unit price`}
                    className="w-20 rounded border border-gray-300 px-1 py-0.5 text-sm"
                  />
                  {fieldErrors[`item-${index}-unit_price`] && (
                    <p role="alert" className="text-xs text-red-600">
                      {fieldErrors[`item-${index}-unit_price`]}
                    </p>
                  )}
                </td>
                <td className="py-1 pr-1">
                  <input
                    type="text"
                    value={row.line_total}
                    onChange={(e) => updateItem(index, 'line_total', e.target.value)}
                    aria-label={`Item ${index + 1} line total`}
                    className="w-20 rounded border border-gray-300 px-1 py-0.5 text-sm"
                  />
                  {fieldErrors[`item-${index}-line_total`] && (
                    <p role="alert" className="text-xs text-red-600">
                      {fieldErrors[`item-${index}-line_total`]}
                    </p>
                  )}
                </td>
                <td className="py-1">
                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    aria-label={`Remove item ${index + 1}`}
                    className="text-xs text-red-600 underline"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          onClick={addItem}
          className="mt-1 text-xs font-medium text-blue-600 underline"
        >
          Add item
        </button>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-medium text-gray-700">Discounts</h3>
        {discounts.map((row, index) => (
          <div key={index} className="mb-1 flex items-center gap-2">
            <input
              type="text"
              value={row.description}
              onChange={(e) => updateDiscount(index, 'description', e.target.value)}
              aria-label={`Discount ${index + 1} description`}
              className="flex-1 rounded border border-gray-300 px-1 py-0.5 text-sm"
            />
            <input
              type="text"
              value={row.amount}
              onChange={(e) => updateDiscount(index, 'amount', e.target.value)}
              aria-label={`Discount ${index + 1} amount`}
              className="w-20 rounded border border-gray-300 px-1 py-0.5 text-sm"
            />
            <button
              type="button"
              onClick={() => removeDiscount(index)}
              aria-label={`Remove discount ${index + 1}`}
              className="text-xs text-red-600 underline"
            >
              Remove
            </button>
            {fieldErrors[`discount-${index}-amount`] && (
              <p role="alert" className="text-xs text-red-600">
                {fieldErrors[`discount-${index}-amount`]}
              </p>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={addDiscount}
          className="text-xs font-medium text-blue-600 underline"
        >
          Add discount
        </button>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-medium text-gray-700">Taxes</h3>
        {taxes.map((row, index) => (
          <div key={index} className="mb-1 flex items-center gap-2">
            <input
              type="text"
              value={row.description}
              onChange={(e) => updateTax(index, 'description', e.target.value)}
              aria-label={`Tax ${index + 1} description`}
              className="flex-1 rounded border border-gray-300 px-1 py-0.5 text-sm"
            />
            <input
              type="text"
              value={row.amount}
              onChange={(e) => updateTax(index, 'amount', e.target.value)}
              aria-label={`Tax ${index + 1} amount`}
              className="w-20 rounded border border-gray-300 px-1 py-0.5 text-sm"
            />
            <button
              type="button"
              onClick={() => removeTax(index)}
              aria-label={`Remove tax ${index + 1}`}
              className="text-xs text-red-600 underline"
            >
              Remove
            </button>
            {fieldErrors[`tax-${index}-amount`] && (
              <p role="alert" className="text-xs text-red-600">
                {fieldErrors[`tax-${index}-amount`]}
              </p>
            )}
          </div>
        ))}
        <button type="button" onClick={addTax} className="text-xs font-medium text-blue-600 underline">
          Add tax
        </button>
      </div>

      <label className="flex flex-col gap-1 text-sm font-semibold text-gray-900">
        Total
        <input
          type="text"
          value={total}
          onChange={(e) => setTotal(e.target.value)}
          aria-label="Total"
          className="rounded border border-gray-300 px-2 py-1 text-sm font-normal"
        />
        {fieldErrors.total && (
          <p role="alert" className="text-xs font-normal text-red-600">
            {fieldErrors.total}
          </p>
        )}
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="rounded bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-800"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export default ReceiptEditForm
