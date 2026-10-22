import { formatMoney } from './formatMoney'

test('formats with the currency code by default', () => {
  expect(formatMoney(79.4, 'USD')).toBe('USD 79.40')
})

test('omits the currency code when includeCurrency is false', () => {
  expect(formatMoney(79.4, 'USD', { includeCurrency: false })).toBe('79.40')
})

test('uses the currency\'s own decimal precision (e.g. JPY has none)', () => {
  expect(formatMoney(500, 'JPY')).toBe('JPY 500')
})

test('null/undefined/NaN amounts show "Not detected"', () => {
  expect(formatMoney(null, 'USD')).toBe('Not detected')
  expect(formatMoney(undefined, 'USD')).toBe('Not detected')
  expect(formatMoney(NaN, 'USD')).toBe('Not detected')
})

test('null currency falls back to a plain 2-decimal amount', () => {
  expect(formatMoney(79.4, null)).toBe('79.40')
})

test('a malformed currency code does not throw and falls back to a plain amount', () => {
  expect(() => formatMoney(79.4, 'US$')).not.toThrow()
  expect(formatMoney(79.4, 'US$')).toBe('79.40')
})

test('never outputs "NaN", "null" or "undefined"', () => {
  for (const result of [
    formatMoney(null, null),
    formatMoney(undefined, undefined),
    formatMoney(NaN, 'US$'),
  ]) {
    expect(result).not.toMatch(/NaN|null|undefined/i)
  }
})
