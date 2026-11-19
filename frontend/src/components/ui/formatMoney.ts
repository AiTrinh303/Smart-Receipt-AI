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
  /** Prefix the amount with its currency code, e.g. "USD 79.40". */
  includeCurrency?: boolean
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
    return value.toFixed(2)
  }

  const decimals = resolveDecimals(currency)
  if (decimals === null) {
    // Malformed currency: don't show an untrustworthy code, just the amount.
    return value.toFixed(2)
  }

  const amount = value.toFixed(decimals)
  return includeCurrency ? `${currency} ${amount}` : amount
}

/** Displays an amount that already arrived as a decimal STRING (e.g. the
 * yearly report's totals, "1234.56"/"-12.50"/"0.00") -- the string is
 * shown exactly as given, never parsed into a number and re-formatted,
 * which would be arithmetic this app's money rule forbids. Same
 * null/undefined/blank fallback as `formatMoney`. */
export function formatMoneyFromString(
  value: string | null | undefined,
  currency: string | null | undefined,
  { includeCurrency = true }: FormatMoneyOptions = {},
): string {
  if (value === null || value === undefined || value === '') {
    return NOT_DETECTED
  }

  return includeCurrency && currency ? `${currency} ${value}` : value
}
