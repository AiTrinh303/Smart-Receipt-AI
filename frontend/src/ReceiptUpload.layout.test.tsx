import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReceiptUpload from './ReceiptUpload'
import { mockObjectUrl } from './test/objectUrl'
import { SAMPLE_APARTMENTS, jsonResponse, withApartments } from './test/apartmentsFetch'

beforeEach(() => {
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

let objectUrl: ReturnType<typeof mockObjectUrl>
beforeEach(() => {
  objectUrl = mockObjectUrl()
})
afterEach(() => {
  objectUrl.restore()
})

let fetchSpy: jest.Mock
beforeEach(() => {
  fetchSpy = jest.fn().mockImplementation(withApartments(() => Promise.reject(new Error('Unexpected fetch call'))))
  global.fetch = fetchSpy as unknown as typeof fetch
})
afterEach(() => {
  // @ts-expect-error cleaning up the test-only global fetch stub
  delete global.fetch
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

test('the form has two numbered sections, "Apartment" and "Receipts", with aria-hidden number badges', async () => {
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })

  const apartmentHeading = screen.getByRole('heading', { level: 2, name: 'Apartment' })
  const receiptsHeading = screen.getByRole('heading', { level: 2, name: 'Receipts' })
  expect(apartmentHeading).toBeInTheDocument()
  expect(receiptsHeading).toBeInTheDocument()

  // The visible numbers are decorative badges, not part of the heading's
  // accessible name.
  expect(screen.getByText('1', { selector: '[aria-hidden="true"]' })).toBeInTheDocument()
  expect(screen.getByText('2', { selector: '[aria-hidden="true"]' })).toBeInTheDocument()

  // The existing legend text is unchanged, nested inside section 1.
  expect(screen.getByRole('radiogroup', { name: 'Which apartment is this receipt for?' })).toBeInTheDocument()
})

test('the help panel uses the standard Card elevation (never a stronger one) and is sticky from lg', async () => {
  mockMatchMedia(true)
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })

  const panelHeading = screen.getByRole('heading', { level: 2, name: 'How it works' })
  const panelCard = panelHeading.closest('div') as HTMLElement
  expect(panelCard.className).not.toContain('shadow-popover')
  expect(panelCard.className).toContain('shadow-card')
  expect(panelCard.className).toContain('lg:sticky')
})

test('at a wide (lg) screen, the static help panel is shown and the collapsible tips are not', async () => {
  mockMatchMedia(true)
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })

  expect(screen.getByRole('heading', { level: 2, name: 'How it works' })).toBeInTheDocument()
  expect(screen.getByText('Choose the apartment.')).toBeInTheDocument()
  expect(screen.getByText('Add photos or PDFs.')).toBeInTheDocument()
  expect(screen.getByText('Check the result in History or Items. The Report counts every receipt, reviewed or not.')).toBeInTheDocument()

  // Tips text appears exactly once (inside the panel), never in a <details>
  expect(screen.getAllByText('Lay the receipt flat.')).toHaveLength(1)
  expect(screen.queryByText('Tips for better reading', { selector: 'summary *, summary' })).not.toBeInTheDocument()
  expect(document.querySelector('details')).not.toBeInTheDocument()
})

test('below lg (or when matchMedia is unavailable), the help panel is absent and tips stay in a collapsible <details>', async () => {
  // No mockMatchMedia call -- matches the "matchMedia unavailable" default,
  // which must render the same below-lg variant.
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })

  expect(screen.queryByRole('heading', { level: 2, name: 'How it works' })).not.toBeInTheDocument()
  const details = document.querySelector('details')
  expect(details).toBeInTheDocument()
  expect(screen.getByText('Tips for better reading')).toBeInTheDocument()

  // Tips text appears exactly once (inside the <details>), never duplicated
  // by a panel that isn't rendered
  expect(screen.getAllByText('Lay the receipt flat.')).toHaveLength(1)
})

test('the collapsible tips are a real, focusable <summary> that expands on click to show every tip', async () => {
  const user = userEvent.setup()
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })

  const summary = screen.getByText('Tips for better reading').closest('summary') as HTMLElement
  expect(summary).toBeInTheDocument()
  const details = summary.closest('details') as HTMLDetailsElement
  expect(details.open).toBe(false)

  // <summary> is natively focusable and keyboard-operable (Enter/Space
  // toggle it) in a real browser -- jsdom doesn't simulate that native
  // key handling, so this confirms it's real, focusable markup and that a
  // click (the mechanism jsdom *does* support) opens it to reveal every tip.
  summary.focus()
  expect(document.activeElement).toBe(summary)

  await user.click(summary)
  expect(details.open).toBe(true)
  expect(screen.getByText('Use good light.')).toBeVisible()
  expect(screen.getByText('Keep the whole receipt in frame, including the total.')).toBeVisible()
  expect(screen.getByText('One receipt per photo.')).toBeVisible()
})

test('dropzone remains functional and visible with a brand-subtle idle background class', async () => {
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: SAMPLE_APARTMENTS[0].name })

  const dropzone = screen.getByRole('button', { name: /drag receipts here/i })
  expect(dropzone.className).toContain('bg-brand-subtle')
  expect(dropzone.className).toContain('border-border')
})
