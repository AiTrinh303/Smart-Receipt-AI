import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BatchQueue from './BatchQueue'
import type { BatchItem } from './batchReducer'
import { mockObjectUrl } from '../test/objectUrl'

let objectUrl: ReturnType<typeof mockObjectUrl>
beforeEach(() => {
  objectUrl = mockObjectUrl()
})
afterEach(() => {
  objectUrl.restore()
})

function makeItem(overrides: Partial<BatchItem> & Pick<BatchItem, 'id' | 'file'>): BatchItem {
  return { status: 'waiting', ...overrides }
}

function makeImageFile(name = 'receipt.jpg'): File {
  return new File(['dummy'], name, { type: 'image/jpeg' })
}

function makePdfFile(name = 'receipt.pdf'): File {
  return new File(['%PDF-1.4'], name, { type: 'application/pdf' })
}

test('Given one image and one PDF item, When rendered, Then one row appears per file and only the image gets a thumbnail', async () => {
  const items = [
    makeItem({ id: '1', file: makeImageFile('a.jpg') }),
    makeItem({ id: '2', file: makePdfFile('b.pdf') }),
  ]

  const { container } = render(<BatchQueue items={items} rejected={[]} onRetry={() => {}} onRemove={() => {}} onUploadAnyway={() => {}} />)

  expect(await screen.findAllByRole('listitem')).toHaveLength(2)
  expect(screen.getByText('a.jpg')).toBeInTheDocument()
  expect(screen.getByText('b.pdf')).toBeInTheDocument()
  // Only the image gets an <img> thumbnail (a decorative alt="" image has
  // no accessible "img" role, so it's queried directly rather than via
  // getByRole).
  const images = container.querySelectorAll('img')
  expect(images).toHaveLength(1)
  expect((images[0] as HTMLImageElement).src).toBe('blob:mock-url-0')
})

test('Given an image item, When it mounts, Then createObjectURL is called with that file', async () => {
  const file = makeImageFile('a.jpg')
  const items = [makeItem({ id: '1', file })]

  const { container } = render(<BatchQueue items={items} rejected={[]} onRetry={() => {}} onRemove={() => {}} onUploadAnyway={() => {}} />)

  await waitFor(() => expect(container.querySelector('img')).not.toBeNull())
  expect(objectUrl.createObjectURL).toHaveBeenCalledWith(file)
})

test('Given an image item is removed from the items prop, When re-rendered without it, Then its object URL is revoked', async () => {
  const items = [makeItem({ id: '1', file: makeImageFile('a.jpg') })]
  const { container, rerender } = render(
    <BatchQueue items={items} rejected={[]} onRetry={() => {}} onRemove={() => {}} onUploadAnyway={() => {}} />,
  )
  await waitFor(() => expect(container.querySelector('img')).not.toBeNull())

  rerender(<BatchQueue items={[]} rejected={[]} onRetry={() => {}} onRemove={() => {}} onUploadAnyway={() => {}} />)

  await waitFor(() => expect(objectUrl.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url-0'))
})

test('Given an image item is showing, When the component unmounts, Then its object URL is revoked', async () => {
  const items = [makeItem({ id: '1', file: makeImageFile('a.jpg') })]
  const { container, unmount } = render(
    <BatchQueue items={items} rejected={[]} onRetry={() => {}} onRemove={() => {}} onUploadAnyway={() => {}} />,
  )
  await waitFor(() => expect(container.querySelector('img')).not.toBeNull())

  unmount()

  expect(objectUrl.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url-0')
})

test('the Remove button is icon-only and its accessible name contains the file name', async () => {
  const items = [makeItem({ id: '1', file: makeImageFile('receipt-one.jpg') })]
  render(<BatchQueue items={items} rejected={[]} onRetry={() => {}} onRemove={() => {}} onUploadAnyway={() => {}} />)

  const removeButton = await screen.findByRole('button', { name: 'Remove receipt-one.jpg' })
  // Icon-only: no visible text content beyond the aria-label
  expect(removeButton).toHaveTextContent('')
})

test('clicking Remove calls onRemove with that item\'s id', async () => {
  const onRemove = jest.fn()
  const items = [makeItem({ id: 'item-1', file: makeImageFile('a.jpg') })]
  const user = userEvent.setup()
  render(<BatchQueue items={items} rejected={[]} onRetry={() => {}} onRemove={onRemove} onUploadAnyway={() => {}} />)

  await user.click(await screen.findByRole('button', { name: 'Remove a.jpg' }))

  expect(onRemove).toHaveBeenCalledWith('item-1')
})

test('a failed item keeps its error text and a Retry button under the row line, alongside the Remove icon', async () => {
  const items = [
    makeItem({ id: '1', file: makeImageFile('a.jpg'), status: 'failed', error: 'Could not read this receipt.' }),
  ]
  render(<BatchQueue items={items} rejected={[]} onRetry={() => {}} onRemove={() => {}} onUploadAnyway={() => {}} />)

  expect(screen.getByText('Could not read this receipt.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^retry$/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Remove a.jpg' })).toBeInTheDocument()
})

test('a done item with no receiptId or warnings shows no secondary line', () => {
  const items = [makeItem({ id: '1', file: makeImageFile('a.jpg'), status: 'done' })]
  render(<BatchQueue items={items} rejected={[]} onRetry={() => {}} onRemove={() => {}} onUploadAnyway={() => {}} />)

  expect(screen.queryByRole('link', { name: /^open$/i })).not.toBeInTheDocument()
  expect(screen.queryByText(/check values/i)).not.toBeInTheDocument()
})

// --- Skipped rows (duplicate / duplicate_in_batch) --------------------------

const SAMPLE_EXISTING = {
  receipt_id: 'existing-1',
  original_filename: 'receipt.jpg',
  store_name: 'Corner Store',
  purchase_date: '2026-01-15',
  currency: 'EUR',
  total: 19.99,
  created_at: '2026-01-15T10:00:00+00:00',
  apartment_id: 'oberaudorf-bergblick',
  apartment_name: 'Fewo JoJo - Oberaudorf - Bergblick',
  status: 'needs_review' as const,
}

test('a server-matched duplicate shows the "Already saved" badge, the summary line, an "Open saved receipt" link and both buttons', async () => {
  const items = [
    makeItem({
      id: '1',
      file: makeImageFile('a.jpg'),
      status: 'skipped',
      errorKind: 'duplicate',
      existing: SAMPLE_EXISTING,
    }),
  ]
  render(<BatchQueue items={items} rejected={[]} onRetry={() => {}} onRemove={() => {}} onUploadAnyway={() => {}} />)

  expect(screen.getByText('Already saved')).toBeInTheDocument()
  expect(
    screen.getByText(
      (_, element) =>
        element?.tagName.toLowerCase() === 'p' &&
        element.textContent === 'Same file as Corner Store · 15.01.2026 · EUR 19.99 · Bergblick',
    ),
  ).toBeInTheDocument()

  const link = screen.getByRole('link', { name: 'Open saved receipt' })
  expect(link).toHaveAttribute('href', '/?receipt=existing-1')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')

  expect(screen.getByRole('button', { name: 'Upload anyway' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Remove a.jpg' })).toBeInTheDocument()
})

test('a duplicate_in_batch item shows "Same file twice", no summary line, no link, and no "Upload anyway"', async () => {
  const items = [makeItem({ id: '1', file: makeImageFile('a.jpg'), status: 'skipped', errorKind: 'duplicate_in_batch' })]
  render(<BatchQueue items={items} rejected={[]} onRetry={() => {}} onRemove={() => {}} onUploadAnyway={() => {}} />)

  expect(screen.getByText('Same file twice')).toBeInTheDocument()
  expect(screen.queryByText(/^Same file as/)).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Open saved receipt' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Upload anyway' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Remove a.jpg' })).toBeInTheDocument()
})

test('a duplicate with a missing store/date/total/apartment shows MissingValue for each missing part', async () => {
  const items = [
    makeItem({
      id: '1',
      file: makeImageFile('a.jpg'),
      status: 'skipped',
      errorKind: 'duplicate',
      existing: {
        ...SAMPLE_EXISTING,
        store_name: null,
        purchase_date: null,
        total: null,
        apartment_name: null,
      },
    }),
  ]
  const { container } = render(
    <BatchQueue items={items} rejected={[]} onRetry={() => {}} onRemove={() => {}} onUploadAnyway={() => {}} />,
  )

  // 4 missing parts -> 4 "Not detected" screen-reader-only spans
  const hidden = Array.from(container.querySelectorAll('.sr-only')).filter((el) => el.textContent === 'Not detected')
  expect(hidden).toHaveLength(4)
})

test('clicking "Upload anyway" calls onUploadAnyway with the item id', async () => {
  const onUploadAnyway = jest.fn()
  const items = [
    makeItem({ id: 'item-1', file: makeImageFile('a.jpg'), status: 'skipped', errorKind: 'duplicate', existing: SAMPLE_EXISTING }),
  ]
  const user = userEvent.setup()
  render(<BatchQueue items={items} rejected={[]} onRetry={() => {}} onRemove={() => {}} onUploadAnyway={onUploadAnyway} />)

  await user.click(screen.getByRole('button', { name: 'Upload anyway' }))

  expect(onUploadAnyway).toHaveBeenCalledWith('item-1')
})

test('a skipped item\'s Remove button calls onRemove, same as waiting/failed', async () => {
  const onRemove = jest.fn()
  const items = [
    makeItem({ id: 'item-1', file: makeImageFile('a.jpg'), status: 'skipped', errorKind: 'duplicate_in_batch' }),
  ]
  const user = userEvent.setup()
  render(<BatchQueue items={items} rejected={[]} onRetry={() => {}} onRemove={onRemove} onUploadAnyway={() => {}} />)

  await user.click(screen.getByRole('button', { name: 'Remove a.jpg' }))

  expect(onRemove).toHaveBeenCalledWith('item-1')
})
