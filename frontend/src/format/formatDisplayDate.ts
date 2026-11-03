export type DisplayDate =
  | { kind: 'date'; text: string }
  | { kind: 'raw'; text: string }
  | { kind: 'missing' }

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false
  if (day < 1) return false
  const maxDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]
  return day <= maxDay
}

/**
 * Formats a stored `purchase_date` for display, without ever going through
 * `Date`/`Intl` -- both introduce time-zone and locale effects that have
 * nothing to do with what the server actually stored (e.g. `new
 * Date("2026-06-02")` parses as UTC midnight, which can render as "01 June"
 * in a timezone behind UTC, and `toLocaleDateString` picks a format and
 * month names from the runtime's locale, not a fixed one). Instead, a plain
 * `YYYY-MM-DD` string is split into integers and checked by hand (leap
 * years included), so the result is 100% deterministic regardless of the
 * environment's `TZ` or locale.
 */
export function formatDisplayDate(value: string | null): DisplayDate {
  if (value === null) {
    return { kind: 'missing' }
  }

  const trimmed = value.trim()
  if (trimmed === '') {
    return { kind: 'missing' }
  }

  const match = ISO_DATE_PATTERN.exec(trimmed)
  if (match) {
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    if (isValidCalendarDate(year, month, day)) {
      return { kind: 'date', text: `${match[3]}.${match[2]}.${match[1]}` }
    }
  }

  return { kind: 'raw', text: trimmed }
}
