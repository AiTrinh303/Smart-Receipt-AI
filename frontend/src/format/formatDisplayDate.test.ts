import { formatDisplayDate } from './formatDisplayDate'

test('a valid ISO date formats as DD.MM.YYYY', () => {
  // Given a valid ISO date
  // When it is formatted for display
  const result = formatDisplayDate('2026-06-02')

  // Then it comes back as DD.MM.YYYY
  expect(result).toEqual({ kind: 'date', text: '02.06.2026' })
})

test('2024-02-29 is accepted as a valid leap-year date', () => {
  const result = formatDisplayDate('2024-02-29')
  expect(result).toEqual({ kind: 'date', text: '29.02.2024' })
})

test('2025-02-29 is rejected (not a leap year) and treated as raw text', () => {
  const result = formatDisplayDate('2025-02-29')
  expect(result).toEqual({ kind: 'raw', text: '2025-02-29' })
})

test('2026-13-01 (invalid month) is treated as raw text', () => {
  const result = formatDisplayDate('2026-13-01')
  expect(result).toEqual({ kind: 'raw', text: '2026-13-01' })
})

test('2026-00-10 (invalid month) is treated as raw text', () => {
  const result = formatDisplayDate('2026-00-10')
  expect(result).toEqual({ kind: 'raw', text: '2026-00-10' })
})

test('a non-ISO string like "02.06.2026" is treated as raw text', () => {
  const result = formatDisplayDate('02.06.2026')
  expect(result).toEqual({ kind: 'raw', text: '02.06.2026' })
})

test('an empty string is treated as missing', () => {
  expect(formatDisplayDate('')).toEqual({ kind: 'missing' })
})

test('a whitespace-only string is treated as missing', () => {
  expect(formatDisplayDate('   ')).toEqual({ kind: 'missing' })
})

test('null is treated as missing', () => {
  expect(formatDisplayDate(null)).toEqual({ kind: 'missing' })
})

test('the result does not depend on the TZ environment variable', () => {
  // Given two different timezones
  const original = process.env.TZ
  try {
    process.env.TZ = 'Pacific/Kiritimati' // UTC+14
    const resultA = formatDisplayDate('2026-06-02')

    process.env.TZ = 'Etc/GMT+12' // UTC-12
    const resultB = formatDisplayDate('2026-06-02')

    // Then the formatted result is identical either way
    expect(resultA).toEqual({ kind: 'date', text: '02.06.2026' })
    expect(resultB).toEqual({ kind: 'date', text: '02.06.2026' })
  } finally {
    process.env.TZ = original
  }
})
