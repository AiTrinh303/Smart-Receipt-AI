import type { ReceiptExtraction } from './api/types'

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

function displayQuantity(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? NOT_DETECTED : String(value)
}

interface ReceiptResultProps {
  data: ReceiptExtraction
  onReset: () => void
}

function ReceiptResult({ data, onReset }: ReceiptResultProps) {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 rounded-lg border border-gray-300 p-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{displayText(data.store_name)}</h2>
        <p className="text-sm text-gray-600">
          {displayText(data.purchase_date)} · {displayText(data.currency)}
        </p>
      </div>

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-gray-500">
            <th scope="col" className="py-1 pr-2 font-medium">
              Item
            </th>
            <th scope="col" className="py-1 pr-2 font-medium">
              Qty
            </th>
            <th scope="col" className="py-1 pr-2 font-medium">
              Unit price
            </th>
            <th scope="col" className="py-1 font-medium">
              Line total
            </th>
          </tr>
        </thead>
        <tbody>
          {data.items.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-2 text-gray-500">
                None detected
              </td>
            </tr>
          ) : (
            data.items.map((item, index) => (
              <tr key={index} className="border-b border-gray-100">
                <td className="py-1 pr-2">{displayText(item.name)}</td>
                <td className="py-1 pr-2">{displayQuantity(item.quantity)}</td>
                <td className="py-1 pr-2">{displayAmount(item.unit_price, data.currency)}</td>
                <td className="py-1">{displayAmount(item.line_total, data.currency)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div>
        <h3 className="text-sm font-medium text-gray-700">Discounts</h3>
        {data.discounts.length === 0 ? (
          <p className="text-sm text-gray-500">None detected</p>
        ) : (
          <ul className="text-sm text-gray-600">
            {data.discounts.map((discount, index) => (
              <li key={index}>
                {displayText(discount.description)}: {displayAmount(discount.amount, data.currency)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-700">Taxes</h3>
        {data.taxes.length === 0 ? (
          <p className="text-sm text-gray-500">None detected</p>
        ) : (
          <ul className="text-sm text-gray-600">
            {data.taxes.map((tax, index) => (
              <li key={index}>
                {displayText(tax.description)}: {displayAmount(tax.amount, data.currency)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-lg font-semibold text-gray-900">
        Total: {displayAmount(data.total, data.currency)}
      </p>

      <button
        type="button"
        onClick={onReset}
        className="rounded bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-300"
      >
        Upload another receipt
      </button>
    </div>
  )
}

export default ReceiptResult
