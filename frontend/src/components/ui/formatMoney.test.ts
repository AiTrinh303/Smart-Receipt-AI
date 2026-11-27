import { currencySymbol, formatMoney, formatMoneyFromString } from './formatMoney'

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

// --- formatMoneyFromString: decimal strings, no arithmetic -----------------

test('formatMoneyFromString shows the decimal string exactly as given, with its currency', () => {
  expect(formatMoneyFromString('0.30', 'EUR')).toBe('€0.30')
  expect(formatMoneyFromString('1234.56', 'USD')).toBe('USD 1234.56')
  expect(formatMoneyFromString('-12.50', 'EUR')).toBe('-€12.50')
  expect(formatMoneyFromString('0.00', 'EUR')).toBe('€0.00')
})

test('formatMoneyFromString omits the currency when includeCurrency is false', () => {
  expect(formatMoneyFromString('1234.56', 'USD', { includeCurrency: false })).toBe('1234.56')
})

test('formatMoneyFromString null/undefined/blank show "Not detected"', () => {
  expect(formatMoneyFromString(null, 'USD')).toBe('Not detected')
  expect(formatMoneyFromString(undefined, 'USD')).toBe('Not detected')
  expect(formatMoneyFromString('', 'USD')).toBe('Not detected')
})

test('formatMoneyFromString never outputs "NaN", "null" or "undefined"', () => {
  for (const result of [
    formatMoneyFromString(null, null),
    formatMoneyFromString(undefined, undefined),
    formatMoneyFromString('0.00', null),
  ]) {
    expect(result).not.toMatch(/NaN|null|undefined/i)
  }
})

// --- "€" for EUR -------------------------------------------------------------

test('EUR amounts show the € sign, with a minus sign before it', () => {
  // Given EUR amounts, as numbers and as decimal strings
  // Then they read "€8.49" / "-€0.12", never "EUR 8.49"
  expect(formatMoney(8.49, 'EUR')).toBe('€8.49')
  expect(formatMoney(-0.12, 'EUR')).toBe('-€0.12')
  expect(formatMoneyFromString('8.49', 'EUR')).toBe('€8.49')
  expect(formatMoneyFromString('-0.12', 'EUR')).toBe('-€0.12')
  // And a lower-case or padded code is still recognized as EUR
  expect(formatMoney(1, 'eur')).toBe('€1.00')
})

test('other currencies keep their code, exactly as before', () => {
  expect(formatMoney(4.99, 'USD')).toBe('USD 4.99')
  expect(formatMoney(-0.12, 'USD')).toBe('USD -0.12')
  expect(formatMoneyFromString('-12.50', 'CHF')).toBe('CHF -12.50')
})

test('without the currency prefix, EUR amounts are plain numbers', () => {
  expect(formatMoney(8.49, 'EUR', { includeCurrency: false })).toBe('8.49')
})

test('currencySymbol labels EUR as € and leaves other codes alone', () => {
  expect(currencySymbol('EUR')).toBe('€')
  expect(currencySymbol('USD')).toBe('USD')
})
