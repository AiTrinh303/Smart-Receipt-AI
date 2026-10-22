import type { ReceiptExtraction } from './api/types'
import Button from './components/ui/Button'
import { formatMoney } from './components/ui/formatMoney'

const NOT_DETECTED = 'Not detected'

function displayText(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? NOT_DETECTED : value
}

function displayQuantity(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? NOT_DETECTED : String(value)
}

function PencilIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
      <path
        d="M13.5 3.5l3 3L6 17H3v-3l10.5-10.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface AmountRowProps {
  description: string | null
  amount: number | null
  currency: string | null
}

function AmountRow({ description, amount, currency }: AmountRowProps) {
  return (
    <li className="flex items-baseline justify-between gap-4">
      <span>{displayText(description)}</span>
      <span className="whitespace-nowrap tabular-nums">{formatMoney(amount, currency)}</span>
    </li>
  )
}

interface ReceiptResultProps {
  data: ReceiptExtraction
  onReset: () => void
  onEdit: () => void
}

function ReceiptResult({ data, onReset, onEdit }: ReceiptResultProps) {
  const currencyLabel = data.currency ? ` (${data.currency})` : ''

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-ink">{displayText(data.store_name)}</h1>
          <p
            className="mt-1 text-sm text-ink-muted"
            aria-label={`Date: ${displayText(data.purchase_date)}, Currency: ${displayText(data.currency)}`}
          >
            {displayText(data.purchase_date)} · {displayText(data.currency)}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onEdit} className="flex-shrink-0">
          <PencilIcon />
          Edit
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Receipt items</caption>
          <thead>
            <tr className="border-b border-border text-ink-muted">
              <th scope="col" className="py-1 pr-2 font-medium">
                Item
              </th>
              <th scope="col" className="py-1 pr-2 text-right font-medium">
                Qty
              </th>
              <th scope="col" className="whitespace-nowrap py-1 pr-2 text-right font-medium">
                Unit price{currencyLabel}
              </th>
              <th scope="col" className="whitespace-nowrap py-1 text-right font-medium">
                Line total{currencyLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-2 text-ink-muted">
                  None detected
                </td>
              </tr>
            ) : (
              data.items.map((item, index) => (
                <tr key={index} className="border-b border-border/40">
                  <td className="py-1 pr-2">{displayText(item.name)}</td>
                  <td className="whitespace-nowrap py-1 pr-2 text-right tabular-nums">
                    {displayQuantity(item.quantity)}
                  </td>
                  <td className="whitespace-nowrap py-1 pr-2 text-right tabular-nums">
                    {formatMoney(item.unit_price, data.currency, { includeCurrency: false })}
                  </td>
                  <td className="whitespace-nowrap py-1 text-right tabular-nums">
                    {formatMoney(item.line_total, data.currency, { includeCurrency: false })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 text-sm">
        <div>
          <h2 className="font-medium text-ink-muted">Discounts</h2>
          {data.discounts.length === 0 ? (
            <p className="text-ink-muted">None detected</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {data.discounts.map((discount, index) => (
                <AmountRow
                  key={index}
                  description={discount.description}
                  amount={discount.amount}
                  currency={data.currency}
                />
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2 className="font-medium text-ink-muted">Taxes</h2>
          {data.taxes.length === 0 ? (
            <p className="text-ink-muted">None detected</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {data.taxes.map((tax, index) => (
                <AmountRow
                  key={index}
                  description={tax.description}
                  amount={tax.amount}
                  currency={data.currency}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="border-t border-border pt-3 text-lg font-bold text-ink">
        {`Total: ${formatMoney(data.total, data.currency)}`}
      </p>

      <Button variant="secondary" onClick={onReset} className="w-full sm:w-auto sm:self-start">
        Upload another receipt
      </Button>
    </div>
  )
}

export default ReceiptResult
