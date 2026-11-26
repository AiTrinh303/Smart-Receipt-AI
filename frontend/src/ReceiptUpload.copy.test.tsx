import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReceiptUpload from './ReceiptUpload'
import { MAX_BATCH } from './batch/batchReducer'
import { mockObjectUrl } from './test/objectUrl'
import { clearApartmentsCache, jsonResponse, withApartments } from './test/apartmentsFetch'

const LONG_APARTMENTS = [
  { id: 'oberaudorf-bergblick', name: 'Fewo JoJo - Oberaudorf - Bergblick' },
  { id: 'sankt-englmar-waldglueck', name: 'Fewo JoJo - Sankt Englmar - Waldglück' },
]

let objectUrl: ReturnType<typeof mockObjectUrl>

beforeEach(() => {
  window.history.replaceState({}, '', '/')
  clearApartmentsCache()
  objectUrl = mockObjectUrl()
  global.fetch = jest
    .fn()
    .mockImplementation(
      withApartments(
        () => Promise.reject(new Error('Unexpected fetch call')),
        () => Promise.resolve(jsonResponse(200, { items: LONG_APARTMENTS, count: LONG_APARTMENTS.length })),
      ),
    ) as unknown as typeof fetch
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
  clearApartmentsCache()
  objectUrl.restore()
  // @ts-expect-error cleaning up the test-only global fetch stub
  delete global.fetch
})

test('the dropzone says receipts (plural) and names the per-file size and the batch limit from MAX_BATCH', async () => {
  // Given the upload form
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: LONG_APARTMENTS[0].name })

  // Then the dropzone copy is plural and the limit comes from the constant
  const dropzone = screen.getByRole('button', { name: /drag receipts here/i })
  expect(within(dropzone).getByText('Drag receipts here, or')).toBeInTheDocument()
  expect(
    within(dropzone).getByText(`JPG, PNG or PDF, up to 10 MB each. Up to ${MAX_BATCH} files at once.`),
  ).toBeInTheDocument()
  expect(screen.queryByText('Drag a receipt here, or')).not.toBeInTheDocument()
})

test('the "Receipts" heading has no apartment suffix until an apartment is chosen', async () => {
  // Given the upload form with nothing chosen
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: LONG_APARTMENTS[0].name })

  // Then the heading reads just "Receipts"
  expect(screen.getByRole('heading', { level: 2, name: 'Receipts' })).toBeInTheDocument()
  expect(screen.queryByText(/^for /)).not.toBeInTheDocument()
})

test('choosing an apartment adds a muted "for <short name>" to the "Receipts" heading, full name in title', async () => {
  const user = userEvent.setup()
  // Given the upload form
  render(<ReceiptUpload />)

  // When the owner chooses the Waldglück apartment
  await user.click(await screen.findByRole('radio', { name: LONG_APARTMENTS[1].name }))

  // Then the section heading names where the receipts will go
  const heading = screen.getByRole('heading', { level: 2, name: 'Receipts for Waldglück' })
  const suffix = within(heading).getByText('for Waldglück')
  expect(suffix).toHaveAttribute('title', LONG_APARTMENTS[1].name)
  expect(suffix.className).toContain('text-ink-muted')

  // When the owner switches to the other apartment
  await user.click(screen.getByRole('radio', { name: LONG_APARTMENTS[0].name }))

  // Then the suffix follows the new choice
  expect(screen.getByRole('heading', { level: 2, name: 'Receipts for Bergblick' })).toBeInTheDocument()
})

test('the status line under the button is a role="status" region with its existing texts', async () => {
  const user = userEvent.setup()
  // Given nothing chosen
  render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: LONG_APARTMENTS[0].name })

  // Then the combined hint is a status region
  const neither = screen.getByText('Choose an apartment and add a receipt to continue.')
  expect(neither).toHaveAttribute('role', 'status')

  // When an apartment is chosen (still no file)
  await user.click(screen.getByRole('radio', { name: LONG_APARTMENTS[0].name }))

  // Then the file-only hint is a status region too
  expect(screen.getByText('Choose a file to continue.')).toHaveAttribute('role', 'status')
})

test.each([
  ['below lg (no matchMedia)', false],
  ['from lg up', true],
])('no text on the upload form says approval is required (%s)', async (_label, wide) => {
  // Given the upload form at either width
  if (wide) {
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }))
  }
  const { container } = render(<ReceiptUpload />)
  await screen.findByRole('radio', { name: LONG_APARTMENTS[0].name })

  // Then nothing on the screen mentions approving, and the help says the
  // Report counts every receipt
  expect(container.textContent ?? '').not.toMatch(/approv/i)
  if (wide) {
    expect(
      await screen.findByText('Check the result in History or Items. The Report counts every receipt, reviewed or not.'),
    ).toBeInTheDocument()
  }
  // @ts-expect-error cleaning up the test-only global matchMedia stub
  delete window.matchMedia
})
