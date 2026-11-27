const NOT_DETECTED = 'Not detected'

/** Intl throws a RangeError on a malformed/unknown ISO 4217 code (the AI or
 * a manual edit can produce something like "US$"); returns null in that
 * case so the caller can fall back to a plain amount instead of crashing. */
function resolveDecimals(currency: string): number | null {
  try {
    return (
      new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    )
  } catch {
    return null
  }
}

interface FormatMoneyOptions {
  /** Prefix the amount with its currency: "€79.40" for EUR, the code for
   * any other currency ("USD 79.40"). */
  includeCurrency?: boolean
}

function isEuro(currency: string): boolean {
  return currency.trim().toUpperCase() === 'EUR'
}

/** How a currency is labeled on screen: "€" for EUR, otherwise the code as
 * given ("USD"). For headings/column labels such as "Unit price (€)". */
export function currencySymbol(currency: string): string {
  return isEuro(currency) ? '€' : currency
}

/** Puts the currency in front of an amount that is already a finished
 * string: "€8.49"/"-€0.12" (the sign goes before the symbol, as is usual
 * for €), or "USD 4.99"/"USD -0.12" for any other currency, as before.
 * Pure string handling -- the amount itself is never parsed or changed. */
function withCurrency(amount: string, currency: string): string {
  if (!isEuro(currency)) {
    return `${currency} ${amount}`
  }
  return amount.startsWith('-') ? `-€${amount.slice(1)}` : `€${amount}`
}

/** Inserts a comma every three digits in the integer part of an amount
 * that is already a finished decimal string: "1238.45" -> "1,238.45",
 * "-1000.00" -> "-1,000.00", "12345" -> "12,345". Pure string handling --
 * the amount is never parsed into a number, so nothing is rounded or
 * changed; only separators are added. Anything that isn't a plain
 * optional-minus/digits/optional-fraction string is returned unchanged
 * rather than guessed at. */
export function groupThousands(amount: string): string {
  const match = /^(-?)(\d+)(\.\d+)?$/.exec(amount)
  if (!match) {
    return amount
  }
  const [, sign, integerPart, fraction = ''] = match
  return `${sign}${integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction}`
}

export function formatMoney(
  value: number | null | undefined,
  currency: string | null | undefined,
  { includeCurrency = true }: FormatMoneyOptions = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return NOT_DETECTED
  }

  if (!currency) {
    return groupThousands(value.toFixed(2))
  }

  const decimals = resolveDecimals(currency)
  if (decimals === null) {
    // Malformed currency: don't show an untrustworthy code, just the amount.
    return groupThousands(value.toFixed(2))
  }

  const amount = groupThousands(value.toFixed(decimals))
  return includeCurrency ? withCurrency(amount, currency) : amount
}

/** Displays an amount that already arrived as a decimal STRING (e.g. the
 * yearly report's totals, "1234.56"/"-12.50"/"0.00") -- its digits are
 * shown exactly as given (only thousands separators are added, by
 * `groupThousands`'s string handling), never parsed into a number and
 * re-formatted, which would be arithmetic this app's money rule forbids.
 * Same null/undefined/blank fallback as `formatMoney`. */
export function formatMoneyFromString(
  value: string | null | undefined,
  currency: string | null | undefined,
  { includeCurrency = true }: FormatMoneyOptions = {},
): string {
  if (value === null || value === undefined || value === '') {
    return NOT_DETECTED
  }

  const amount = groupThousands(value)
  return includeCurrency && currency ? withCurrency(amount, currency) : amount
}
