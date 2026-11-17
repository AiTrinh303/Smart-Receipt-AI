import type { LineItem, ReceiptExtraction } from './api/types'
import { formatDisplayDate } from './format/formatDisplayDate'
import { UNRECOGNIZED_DATE_TITLE } from './ReceiptItems'
import Alert from './components/ui/Alert'
import Button from './components/ui/Button'
import MissingValue from './components/ui/MissingValue'
import { formatMoney } from './components/ui/formatMoney'
import { useMediaQuery } from './hooks/useMediaQuery'

const NOT_DETECTED = 'Not detected'

function displayText(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? NOT_DETECTED : value
}

function displayQuantity(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? NOT_DETECTED : String(value)
}

function WarningIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 flex-shrink-0" fill="none">
      <path
        d="M10 3.5l8 13.5H2l8-13.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M10 8.5v3.5M10 14.75h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function DateWarningIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 flex-shrink-0 text-warning" fill="none">
      <path
        d="M10 3.5l8 13.5H2l8-13.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M10 8.5v3.5M10 11.75h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** Shows the receipt's purchase_date in the store-name meta line: a valid
 * ISO date is shown exactly as before (unchanged raw text); a value that
 * doesn't parse as one shows that raw text next to a warning marker (the
 * same pattern the Items table's DateCell already uses, imported from
 * there rather than duplicated); a missing date renders MissingValue. */
function PurchaseDateMeta({ value }: { value: string | null | undefined }) {
  const display = formatDisplayDate(value ?? null)
  if (display.kind === 'missing') {
    return <MissingValue />
  }
  if (display.kind === 'raw') {
    return (
      <span className="inline-flex items-center gap-1" title={UNRECOGNIZED_DATE_TITLE}>
        <DateWarningIcon />
        {display.text}
        <span className="sr-only">Date not recognized</span>
      </span>
    )
  }
  return <>{value}</>
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

interface ItemCardProps {
  item: LineItem
  currency: string | null
  currencyLabel: string
}

function ItemCard({ item, currency, currencyLabel }: ItemCardProps) {
  return (
    <li className="rounded-md border border-border p-3">
      <p className="font-medium text-ink">{displayText(item.name)}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-ink-muted">Qty</dt>
        <dd className="text-right tabular-nums">{displayQuantity(item.quantity)}</dd>
        <dt className="whitespace-nowrap text-ink-muted">Unit price{currencyLabel}</dt>
        <dd className="whitespace-nowrap text-right tabular-nums">
          {formatMoney(item.unit_price, currency, { includeCurrency: false })}
        </dd>
        <dt className="whitespace-nowrap text-ink-muted">Line total{currencyLabel}</dt>
        <dd className="whitespace-nowrap text-right tabular-nums">
          {formatMoney(item.line_total, currency, { includeCurrency: false })}
        </dd>
      </dl>
    </li>
  )
}

interface AmountRowProps {
  description: string | null
  amount: number | null
  currency: string | null
}

/** Plain, right-aligned, tabular amounts -- the currency itself is shown
 * once, in the section heading (see currencySuffix below), rather than
 * repeated on every row ("EUR -0.24", "EUR 0.14" read as noisy, and a
 * repeated "EUR" in a Taxes row could misread as tax added on top of the
 * total). When currency is unknown, formatMoney with includeCurrency:
 * false falls back to the same plain number either way, so nothing
 * breaks. */
function AmountRow({ description, amount, currency }: AmountRowProps) {
  return (
    <li className="flex items-baseline justify-between gap-4">
      <span>{displayText(description)}</span>
      <span className="whitespace-nowrap text-right tabular-nums">
        {formatMoney(amount, currency, { includeCurrency: false })}
      </span>
    </li>
  )
}

const EDITABLE_WARNING_FIELDS = ['purchase_date', 'total'] as const
type EditableWarningField = (typeof EDITABLE_WARNING_FIELDS)[number]

function isEditableWarningField(field: string): field is EditableWarningField {
  return (EDITABLE_WARNING_FIELDS as readonly string[]).includes(field)
}

interface ReceiptResultProps {
  data: ReceiptExtraction
  onEdit: (focusField?: EditableWarningField) => void
}

function ReceiptResult({ data, onEdit }: ReceiptResultProps) {
  const currencyLabel = data.currency ? ` (${data.currency})` : ''
  const isSmallScreen = useMediaQuery('(max-width: 639px)')

  return (
    <div className="flex flex-col gap-4">
      {data.warnings.length > 0 && (
        <Alert variant="warning">
          <div className="flex gap-2">
            <WarningIcon />
            <div>
              <p className="font-semibold">Check these values</p>
              <ul className="mt-1 flex flex-col gap-1.5 list-disc pl-4">
                {data.warnings.map((warning, index) => {
                  const field = warning.field
                  return (
                    <li key={index} className="flex flex-wrap items-center gap-2">
                      <span>{warning.message}</span>
                      {isEditableWarningField(field) && (
                        <Button variant="secondary" size="sm" onClick={() => onEdit(field)}>
                          Fix in Edit
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        </Alert>
      )}

      <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-ink">
            {displayText(data.store_name)}
            {data.edited && (
              <span
                className="ml-2 inline-flex items-center rounded-full bg-warning-soft px-2 py-0.5 align-middle text-xs font-medium text-warning"
                title={data.edited_at ? `Edited ${data.edited_at}` : 'Edited'}
              >
                Edited
              </span>
            )}
          </h1>
          <p
            className="mt-1 text-sm text-ink-muted"
            aria-label={`Date: ${displayText(data.purchase_date)}, Currency: ${displayText(data.currency)}`}
          >
            <PurchaseDateMeta value={data.purchase_date} /> · {displayText(data.currency)}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => onEdit()} className="flex-shrink-0">
          <PencilIcon />
          Edit
        </Button>
      </div>

      {isSmallScreen ? (
        data.items.length === 0 ? (
          <p className="text-sm text-ink-muted">None detected</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.items.map((item, index) => (
              <ItemCard key={index} item={item} currency={data.currency} currencyLabel={currencyLabel} />
            ))}
          </ul>
        )
      ) : (
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
      )}

      <div className="flex flex-col gap-3 text-sm">
        <div>
          <h2 className="font-medium text-ink-muted">Discounts{currencyLabel}</h2>
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
          <h2 className="font-medium text-ink-muted">Taxes{currencyLabel}</h2>
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
      </div>
    </div>
  )
}

export default ReceiptResult
