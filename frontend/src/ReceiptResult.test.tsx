import { render, screen } from '@testing-library/react'
import ReceiptResult from './ReceiptResult'
import type { ReceiptExtraction } from './api/types'

const FULL_DATA: ReceiptExtraction = {
  receipt_id: 'abc-123',
  store_name: 'Corner Store',
  purchase_date: '2026-01-15',
  currency: 'USD',
  items: [
    { name: 'Milk', quantity: 2, unit_price: 2.5, line_total: 5 },
    { name: 'Bread', quantity: 1, unit_price: 3, line_total: 3 },
  ],
  discounts: [{ description: 'Loyalty discount', amount: 0.5 }],
  taxes: [{ description: 'Sales tax', amount: 0.64 }],
  total: 8.14,
}

const EMPTY_DATA: ReceiptExtraction = {
  receipt_id: 'abc-456',
  store_name: null,
  purchase_date: null,
  currency: null,
  items: [],
  discounts: [],
  taxes: [],
  total: null,
}

test('full data: store, date, every item row, discounts, taxes and total are shown', () => {
  // Given a full receipt extraction result
  // When the result is rendered
  render(<ReceiptResult data={FULL_DATA} onReset={() => {}} />)

  // Then the store, date, currency, every item row, discounts, taxes and total are shown
  expect(screen.getByText('Corner Store')).toBeInTheDocument()
  expect(screen.getByText('2026-01-15 · USD')).toBeInTheDocument()
  expect(screen.getByText('Milk')).toBeInTheDocument()
  expect(screen.getByText('Bread')).toBeInTheDocument()
  expect(screen.getByText('2')).toBeInTheDocument()
  expect(screen.getByText('USD 2.50')).toBeInTheDocument()
  expect(screen.getByText('USD 5.00')).toBeInTheDocument()
  expect(screen.getAllByText('USD 3.00')).toHaveLength(2)
  expect(screen.getByText(/Loyalty discount/)).toBeInTheDocument()
  expect(screen.getByText(/Sales tax/)).toBeInTheDocument()
  expect(screen.getByText('Total: USD 8.14')).toBeInTheDocument()
})

test('nulls and empty lists: "Not detected" shown, no crash, no null/undefined/NaN text', () => {
  // Given a receipt extraction result where every field is null or empty
  // When the result is rendered
  render(<ReceiptResult data={EMPTY_DATA} onReset={() => {}} />)

  // Then "Not detected" / "None detected" are shown instead of blank or raw values
  expect(screen.getAllByText('Not detected').length).toBeGreaterThan(0)
  expect(screen.getAllByText('None detected').length).toBeGreaterThan(0)
  expect(screen.getByText('Total: Not detected')).toBeInTheDocument()

  // And no raw null/undefined/NaN text ever leaks into the page
  expect(document.body.textContent).not.toMatch(/\bnull\b/i)
  expect(document.body.textContent).not.toMatch(/\bundefined\b/i)
  expect(document.body.textContent).not.toMatch(/\bNaN\b/i)
})
