import { render, screen } from '@testing-library/react'
import ReceiptResult, { WARNINGS_HEADING_ID } from './ReceiptResult'
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
  warnings: [],
  edited: false,
  edited_at: null,
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
  warnings: [],
  edited: false,
  edited_at: null,
}

test('full data: store, date, every item row, discounts, taxes and total are shown', () => {
  // Given a full receipt extraction result
  // When the result is rendered
  render(<ReceiptResult data={FULL_DATA} onEdit={() => {}} />)

  // Then the store, date, currency, every item row, discounts, taxes and total are shown
  expect(screen.getByRole('heading', { level: 1, name: 'Corner Store' })).toBeInTheDocument()
  expect(screen.getByText('15.01.2026 · USD')).toBeInTheDocument()
  expect(screen.getByText('Milk')).toBeInTheDocument()
  expect(screen.getByText('Bread')).toBeInTheDocument()
  expect(screen.getByText('2')).toBeInTheDocument()

  // Amount cells show plain numbers (no per-cell "USD" prefix); the currency
  // code appears once, in the column headers, instead
  expect(screen.getByText('Unit price (USD)')).toBeInTheDocument()
  expect(screen.getByText('Line total (USD)')).toBeInTheDocument()
  expect(screen.getByText('2.50')).toBeInTheDocument()
  expect(screen.getByText('5.00')).toBeInTheDocument()
  expect(screen.getAllByText('3.00')).toHaveLength(2)

  // The currency itself is shown once, in the section heading, not
  // repeated on every amount row
  expect(screen.getByText('Discounts (USD)')).toBeInTheDocument()
  expect(screen.getByText('Loyalty discount')).toBeInTheDocument()
  expect(screen.getByText('0.50')).toBeInTheDocument()
  expect(screen.getByText('Taxes (USD)')).toBeInTheDocument()
  expect(screen.getByText('Sales tax')).toBeInTheDocument()
  expect(screen.getByText('0.64')).toBeInTheDocument()
  expect(screen.getByText('Total: USD 8.14')).toBeInTheDocument()
})

test('nulls and empty lists: "Not detected" shown, no crash, no null/undefined/NaN text', () => {
  // Given a receipt extraction result where every field is null or empty
  // When the result is rendered
  render(<ReceiptResult data={EMPTY_DATA} onEdit={() => {}} />)

  // Then "Not detected" / "None detected" are shown instead of blank or raw values
  expect(screen.getAllByText('Not detected').length).toBeGreaterThan(0)
  expect(screen.getAllByText('None detected').length).toBeGreaterThan(0)
  expect(screen.getByText('Total: Not detected')).toBeInTheDocument()

  // And no raw null/undefined/NaN text ever leaks into the page
  expect(document.body.textContent).not.toMatch(/\bnull\b/i)
  expect(document.body.textContent).not.toMatch(/\bundefined\b/i)
  expect(document.body.textContent).not.toMatch(/\bNaN\b/i)
})

test('Edit is reachable by role and name, and calls onEdit', () => {
  const onEdit = jest.fn()
  render(<ReceiptResult data={FULL_DATA} onEdit={onEdit} />)

  screen.getByRole('button', { name: /^edit$/i }).click()
  expect(onEdit).toHaveBeenCalledTimes(1)
})

test('a malformed currency code renders without throwing', () => {
  const data = { ...FULL_DATA, currency: 'US$' }
  expect(() => render(<ReceiptResult data={data} onEdit={() => {}} />)).not.toThrow()
})

test('warnings are shown with their messages, titled "Check these values"', () => {
  // Given a receipt with data-quality warnings
  const data = {
    ...FULL_DATA,
    warnings: [
      { code: 'TOTAL_MISMATCH', field: 'total', message: 'The total does not match the items.', details: {} },
      { code: 'MISSING_DATE', field: 'purchase_date', message: 'The purchase date is missing.', details: {} },
    ],
  }

  // When rendered
  render(<ReceiptResult data={data} onEdit={() => {}} />)

  // Then a warning panel lists every message
  expect(screen.getByText('Check these values')).toBeInTheDocument()
  expect(screen.getByText('The total does not match the items.')).toBeInTheDocument()
  expect(screen.getByText('The purchase date is missing.')).toBeInTheDocument()
})

test('no warnings panel when warnings is empty', () => {
  // Given a receipt with no warnings (FULL_DATA)
  render(<ReceiptResult data={FULL_DATA} onEdit={() => {}} />)

  // Then no warning panel is shown
  expect(screen.queryByText('Check these values')).not.toBeInTheDocument()
})

test('the Edited badge shows only when edited is true, with edited_at in its title', () => {
  // Given an edited receipt
  const edited = { ...FULL_DATA, edited: true, edited_at: '2026-01-20T10:00:00+00:00' }
  render(<ReceiptResult data={edited} onEdit={() => {}} />)

  // Then the "Edited" badge is shown with the timestamp in its title
  const badge = screen.getByText('Edited')
  expect(badge).toHaveAttribute('title', expect.stringContaining('2026-01-20T10:00:00+00:00'))
})

test('no Edited badge when edited is false', () => {
  render(<ReceiptResult data={FULL_DATA} onEdit={() => {}} />)
  expect(screen.queryByText('Edited')).not.toBeInTheDocument()
})

function mockMatchMedia(matches: boolean) {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }))
}

afterEach(() => {
  // @ts-expect-error cleaning up the test-only global matchMedia stub
  delete window.matchMedia
})

test('small screen (matchMedia matches): items render as cards, not a table', () => {
  // Given the small-screen media query matches
  mockMatchMedia(true)

  // When the result is rendered
  render(<ReceiptResult data={FULL_DATA} onEdit={() => {}} />)

  // Then each item is a labelled list item, not a table row -- two item
  // cards plus the existing discount and tax list items (4 total)
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  const listItems = screen.getAllByRole('listitem')
  expect(listItems).toHaveLength(4)
  const milkCard = listItems.find((el) => el.textContent?.includes('Milk')) as HTMLElement
  expect(milkCard).toHaveTextContent('Qty')
  expect(milkCard).toHaveTextContent('2')
  expect(milkCard).toHaveTextContent('Unit price (USD)')
  expect(milkCard).toHaveTextContent('2.50')
  expect(milkCard).toHaveTextContent('Line total (USD)')
  expect(milkCard).toHaveTextContent('5.00')
})

test('large screen (matchMedia does not match): the table renders, no item cards', () => {
  // Given the small-screen media query does not match
  mockMatchMedia(false)

  // When the result is rendered
  render(<ReceiptResult data={FULL_DATA} onEdit={() => {}} />)

  // Then the table renders, and only the (unrelated) discount/tax list items exist
  expect(screen.getByRole('table')).toBeInTheDocument()
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
})

test('small screen with null item fields: "Not detected" shown, never NaN/null/undefined', () => {
  mockMatchMedia(true)
  const data = {
    ...EMPTY_DATA,
    items: [{ name: null, quantity: null, unit_price: null, line_total: null }],
  }

  render(<ReceiptResult data={data} onEdit={() => {}} />)

  const card = screen.getAllByRole('listitem')[0]
  expect(card).toHaveTextContent('Not detected')
  expect(document.body.textContent).not.toMatch(/\bnull\b/i)
  expect(document.body.textContent).not.toMatch(/\bundefined\b/i)
  expect(document.body.textContent).not.toMatch(/\bNaN\b/i)
})

// --- Meta line: raw/unrecognized dates and missing dates -------------------

test('an unrecognized purchase_date shows its raw text with a warning marker and hidden "Date not recognized" text', () => {
  const data = { ...FULL_DATA, purchase_date: '26/06/2025' }
  render(<ReceiptResult data={data} onEdit={() => {}} />)

  expect(screen.getByText('26/06/2025')).toBeInTheDocument()
  expect(screen.getByText('Date not recognized')).toBeInTheDocument()
})

test('a missing purchase_date shows MissingValue (a dash, with "Not detected" as hidden text)', () => {
  const data = { ...FULL_DATA, purchase_date: null }
  render(<ReceiptResult data={data} onEdit={() => {}} />)

  // MissingValue's own hidden text, not the plain "Not detected" word used
  // elsewhere for other missing fields
  expect(screen.getAllByText('Not detected').length).toBeGreaterThan(0)
  expect(screen.queryByText('Date not recognized')).not.toBeInTheDocument()
})

test('a valid ISO purchase_date is shown as DD.MM.YYYY, with no warning marker', () => {
  // Given a receipt whose purchase_date is the valid ISO date 2026-01-15
  // When it is rendered
  render(<ReceiptResult data={FULL_DATA} onEdit={() => {}} />)

  // Then the meta line shows 15.01.2026, and its spoken label says the same

  expect(screen.getByText('15.01.2026 · USD')).toBeInTheDocument()
  expect(screen.getByLabelText('Date: 15.01.2026, Currency: USD')).toBeInTheDocument()
  expect(screen.queryByText('Date not recognized')).not.toBeInTheDocument()
})

test('the warning panel shows exactly one warning icon (the Alert\'s own)', () => {
  // Given a receipt with one warning
  render(
    <ReceiptResult
      data={{ ...FULL_DATA, warnings: [{ code: 'MISSING_STORE', field: 'store_name', message: 'Store name is missing.', details: {} }] }}
      onEdit={() => {}}
    />,
  )

  // Then the panel has one icon, and its heading line is a focus target for ReviewBar's link
  const heading = screen.getByText('Check these values')
  const panel = heading.closest('[class*="bg-warning-soft"]') as HTMLElement
  expect(panel.querySelectorAll('svg')).toHaveLength(1)
  expect(heading).toHaveAttribute('id', WARNINGS_HEADING_ID)
  expect(heading).toHaveAttribute('tabindex', '-1')
})

// --- "Fix in Edit" on purchase_date/total warnings -------------------------

test('"Fix in Edit" appears for a purchase_date warning and calls onEdit with that field', () => {
  const onEdit = jest.fn()
  const data = {
    ...FULL_DATA,
    warnings: [
      { code: 'DATE_NOT_STANDARD', field: 'purchase_date', message: 'The date is not standard.', details: {} },
    ],
  }
  render(<ReceiptResult data={data} onEdit={onEdit} />)

  screen.getByRole('button', { name: 'Fix in Edit' }).click()
  expect(onEdit).toHaveBeenCalledWith('purchase_date')
})

test('"Fix in Edit" appears for a total warning and calls onEdit with that field', () => {
  const onEdit = jest.fn()
  const data = {
    ...FULL_DATA,
    warnings: [{ code: 'MISSING_TOTAL', field: 'total', message: 'The total is missing.', details: {} }],
  }
  render(<ReceiptResult data={data} onEdit={onEdit} />)

  screen.getByRole('button', { name: 'Fix in Edit' }).click()
  expect(onEdit).toHaveBeenCalledWith('total')
})

test('"Fix in Edit" does not appear for a warning on another field', () => {
  const data = {
    ...FULL_DATA,
    warnings: [{ code: 'MISSING_STORE', field: 'store_name', message: 'The store name is missing.', details: {} }],
  }
  render(<ReceiptResult data={data} onEdit={() => {}} />)

  expect(screen.queryByRole('button', { name: 'Fix in Edit' })).not.toBeInTheDocument()
})

test('plain "Edit" still calls onEdit with no field', () => {
  const onEdit = jest.fn()
  render(<ReceiptResult data={FULL_DATA} onEdit={onEdit} />)

  screen.getByRole('button', { name: /^edit$/i }).click()
  expect(onEdit).toHaveBeenCalledWith()
})

// --- Discounts/Taxes headings and amounts -----------------------------------

test('a missing currency falls back to plain headings and plain amounts', () => {
  const data = { ...FULL_DATA, currency: null }
  render(<ReceiptResult data={data} onEdit={() => {}} />)

  expect(screen.getByText('Discounts')).toBeInTheDocument()
  expect(screen.queryByText(/Discounts \(/)).not.toBeInTheDocument()
  expect(screen.getByText('Taxes')).toBeInTheDocument()
  expect(screen.getByText('0.50')).toBeInTheDocument()
  expect(screen.getByText('0.64')).toBeInTheDocument()
})

// --- Total row and an empty Discounts list ---------------------------------

test('the Total row shows "Total" and the amount as two visible parts, read once as "Total: <amount>"', () => {
  // Given a full receipt
  render(<ReceiptResult data={FULL_DATA} onEdit={() => {}} />)

  // Then the single spoken string is there, and the visible parts are hidden from assistive tech
  const spoken = screen.getByText('Total: USD 8.14')
  expect(spoken).toHaveClass('sr-only')
  const row = spoken.parentElement as HTMLElement
  const visible = Array.from(row.querySelectorAll('[aria-hidden="true"]')).map((el) => el.textContent)
  expect(visible).toEqual(['Total', 'USD 8.14'])
})

test('no discounts: one muted line "Discounts (USD): None detected" and no Discounts heading', () => {
  // Given a receipt with no discounts
  render(<ReceiptResult data={{ ...FULL_DATA, discounts: [] }} onEdit={() => {}} />)

  // Then one line says so, with no separate heading
  expect(screen.getByText('Discounts (USD): None detected')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Discounts (USD)' })).not.toBeInTheDocument()
  // And Taxes is unchanged
  expect(screen.getByRole('heading', { name: 'Taxes (USD)' })).toBeInTheDocument()
})

test('an EUR receipt labels its columns and section headings with "€", and its total as "€…"', () => {
  // Given a receipt in EUR
  render(<ReceiptResult data={{ ...FULL_DATA, currency: 'EUR' }} onEdit={() => {}} />)

  // Then column and section headings say "(€)", and the total reads "Total: €8.14"
  expect(screen.getByText('Unit price (€)')).toBeInTheDocument()
  expect(screen.getByText('Line total (€)')).toBeInTheDocument()
  expect(screen.getByText('Discounts (€)')).toBeInTheDocument()
  expect(screen.getByText('Total: €8.14')).toBeInTheDocument()
})
