import { useState } from 'react'
import type { ReactNode } from 'react'
import Alert from './components/ui/Alert'
import Button from './components/ui/Button'
import Card from './components/ui/Card'
import ClampedText from './components/ui/ClampedText'
import MissingValue from './components/ui/MissingValue'
import PageHeader from './components/ui/PageHeader'
import RadioCardGroup from './components/ui/RadioCardGroup'
import Skeleton from './components/ui/Skeleton'
import StatusBadge from './components/ui/StatusBadge'
import BatchQueue from './batch/BatchQueue'
import type { BatchItem, RejectedFile } from './batch/batchReducer'
import { EXTRACTION_FAILED_MESSAGE, EXTRACTION_NOT_CONFIGURED_MESSAGE, NETWORK_ERROR_MESSAGE } from './errorMessages'
import {
  ApartmentCell,
  DateCell,
  MoneyCell,
  QuantityCell,
  StatusCell,
  StoreCell,
} from './ReceiptItems'
import { HistoryRow } from './ReceiptHistory'

const BUTTON_VARIANTS = ['primary', 'secondary', 'danger', 'ghost', 'danger-ghost'] as const
const ALERT_VARIANTS = ['info', 'success', 'warning', 'error'] as const

const SAMPLE_APARTMENT_OPTIONS = [
  { value: 'oberaudorf-bergblick', label: 'Oberaudorf Bergblick' },
  { value: 'sankt-englmar-waldglueck', label: 'Sankt Englmar Waldglück' },
]

// The saved-receipt view's apartment choice shows the same two-line
// short-name/place shape the upload form already uses, so this section
// demonstrates that shape (not the plain full-name label above).
const TWO_LINE_APARTMENT_OPTIONS = [
  {
    value: 'oberaudorf-bergblick',
    label: 'Bergblick',
    secondaryLabel: 'Oberaudorf',
    accessibleName: 'Fewo JoJo - Oberaudorf - Bergblick',
  },
  {
    value: 'sankt-englmar-waldglueck',
    label: 'Waldglück',
    secondaryLabel: 'Sankt Englmar',
    accessibleName: 'Fewo JoJo - Sankt Englmar - Waldglück',
  },
]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {children}
    </section>
  )
}

function LogoMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-8 w-8 flex-shrink-0">
      <rect x="1" y="1" width="22" height="22" rx="6" className="fill-brand" />
      <path
        d="M7 5h10v10.5l-1.4 1.3-1.4-1.3-1.4 1.3-1.4-1.3-1.4 1.3-1.4-1.3L7 15.5V5z"
        fill="white"
      />
      <path d="M9 9h6M9 12h6" className="stroke-brand" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}

type ReceiptApartmentState = 'selected' | 'none' | 'saving' | 'saved' | 'error'
type ReceiptStatusState = 'needs_review' | 'approved' | 'saving' | 'blocked'
type BatchPauseState = 'unavailable' | 'network' | 'stopped' | 'finished'

const SAMPLE_BATCH_ITEMS: BatchItem[] = [
  { id: 'batch-sample-1', file: new File([], 'receipt-1.jpg'), status: 'waiting' },
  { id: 'batch-sample-2', file: new File([], 'receipt-2.jpg'), status: 'uploading' },
  { id: 'batch-sample-3', file: new File([], 'receipt-3.jpg'), status: 'reading' },
  {
    id: 'batch-sample-4',
    file: new File([], 'receipt-4.jpg'),
    status: 'done',
    receiptId: 'sample-receipt-id',
    warningsCount: 2,
  },
  {
    id: 'batch-sample-5',
    file: new File([], 'receipt-5.jpg'),
    status: 'failed',
    error: EXTRACTION_FAILED_MESSAGE,
    errorKind: 'unreadable',
  },
]

const SAMPLE_ITEM_ROWS = [
  {
    receipt_id: 'sample-normal',
    line_index: 0,
    name: 'Milk',
    quantity: 2,
    unit_price: 1.5,
    line_total: 3.0,
    currency: 'EUR',
    purchase_date: '2026-01-15',
    store_name: 'Corner Store',
    apartment_name: 'Fewo JoJo - Oberaudorf - Bergblick',
    status: 'needs_review' as const,
  },
  {
    receipt_id: 'sample-unrecognized-date',
    line_index: 0,
    name: 'Bread',
    quantity: 1,
    unit_price: 2.5,
    line_total: 2.5,
    currency: 'EUR',
    purchase_date: '02.06.2026',
    store_name: 'Bakery',
    apartment_name: 'Fewo JoJo - Sankt Englmar - Waldglück',
    status: 'approved' as const,
  },
  {
    receipt_id: 'sample-missing',
    line_index: 0,
    name: null,
    quantity: null,
    unit_price: null,
    line_total: null,
    currency: null,
    purchase_date: null,
    store_name: null,
    apartment_name: null,
    status: null,
  },
  {
    receipt_id: 'sample-long-title',
    line_index: 0,
    name: 'Organic Fair-Trade Single-Origin Ethiopian Yirgacheffe Whole Bean Coffee, Medium Roast, Resealable Bag, 1kg',
    quantity: 1,
    unit_price: 18.9,
    line_total: 18.9,
    currency: 'EUR',
    purchase_date: '2026-02-01',
    store_name: 'Amazon EU S.a r.l., Niederlassung Deutschland',
    apartment_name: 'Fewo JoJo - Oberaudorf - Bergblick',
    status: 'needs_review' as const,
  },
  {
    receipt_id: 'sample-long-store',
    line_index: 0,
    name: 'Light bulbs',
    quantity: 4,
    unit_price: 3.2,
    line_total: 12.8,
    currency: 'EUR',
    purchase_date: '2026-02-03',
    store_name: 'Amazon EU S.a r.l., Niederlassung Deutschland',
    apartment_name: 'Fewo JoJo - Sankt Englmar - Waldglück',
    status: 'approved' as const,
  },
]

const SAMPLE_BATCH_REJECTED: RejectedFile[] = [
  { fileName: 'notes.txt', reason: 'Invalid file type. Please select a JPG, PNG, or PDF file.' },
  { fileName: '', reason: 'Only the first 20 files were added.' },
]

function StyleGuide() {
  const [dropzoneState, setDropzoneState] = useState<'idle' | 'drag-over' | 'file-selected'>('idle')
  const [uploadHelperState, setUploadHelperState] = useState<'neither' | 'file-only' | 'apartment-only'>('neither')
  const [apartmentChoice, setApartmentChoice] = useState<string | null>(null)
  const [receiptApartmentState, setReceiptApartmentState] = useState<ReceiptApartmentState>('selected')
  const [receiptStatusState, setReceiptStatusState] = useState<ReceiptStatusState>('needs_review')
  const [historyTab, setHistoryTab] = useState<'all' | 'oberaudorf'>('all')
  const [batchPauseState, setBatchPauseState] = useState<BatchPauseState>('finished')
  const [batchSummaryState, setBatchSummaryState] = useState<'before-start' | 'running'>('before-start')
  const [itemsViewState, setItemsViewState] = useState<
    'loading' | 'table' | 'cards' | 'empty-unfiltered' | 'empty-filtered' | 'error'
  >('table')
  const [itemsSortSample, setItemsSortSample] = useState('date_desc')

  return (
    <div className="flex flex-col gap-10 pb-16">
      <div>
        <h1 className="text-2xl font-bold text-ink">Style guide</h1>
        <p className="text-sm text-ink-muted">
          Development-only page (<code>?view=styleguide</code>) for checking every component state
          without relying on a backend. Not linked from the app, not included in production
          builds.
        </p>
      </div>

      <Section title="Logo mark">
        <div className="flex items-center gap-2 rounded-card border border-border-subtle bg-surface p-4">
          <LogoMark />
          <span className="text-lg font-bold text-ink">Smart Receipt AI</span>
        </div>
      </Section>

      <Section title="Page header (PageHeader -- one <h1> per view, optional description and actions)">
        <Card className="flex flex-col gap-6">
          <PageHeader title="Upload receipts" description="Read the date, store, items and total automatically." />
          <PageHeader
            title="Items"
            description="Search every purchased item across all your receipts."
            actions={
              <Button variant="secondary" size="sm">
                Export
              </Button>
            }
          />
        </Card>
      </Section>

      <Section title="Numbered section headings (SectionHeading -- the number badge is aria-hidden)">
        <Card className="flex flex-col gap-6">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white"
            >
              1
            </span>
            <h2 className="text-base font-semibold text-ink">Apartment</h2>
            <span className="rounded-full border border-border-subtle px-2 py-0.5 text-xs font-medium text-ink-muted">
              Required
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white"
            >
              2
            </span>
            <h2 className="text-base font-semibold text-ink">Receipts</h2>
          </div>
        </Card>
      </Section>

      <Section title="Upload help panel (static, from lg up -- replaces the collapsible tips; standard Card elevation, sticky on scroll)">
        <div className="max-w-sm">
          <Card className="flex flex-col gap-4">
            <h2 className="text-base font-semibold text-ink">How it works</h2>
            <ol className="flex flex-col gap-3">
              {[
                'Choose the apartment.',
                'Add photos or PDFs.',
                'Review the result and approve it in History or Items.',
              ].map((step, index) => (
                <li key={step} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand-subtle text-xs font-semibold text-brand"
                  >
                    {index + 1}
                  </span>
                  <p className="text-sm text-ink-muted">{step}</p>
                </li>
              ))}
            </ol>
            <div className="flex flex-col gap-2 border-t border-border-subtle pt-4">
              <h3 className="text-sm font-semibold text-ink">Tips for better reading</h3>
              <ul className="flex flex-col gap-1 pl-5 list-disc text-sm text-ink-muted">
                <li>Lay the receipt flat.</li>
                <li>Use good light.</li>
                <li>Keep the whole receipt in frame, including the total.</li>
                <li>One receipt per photo.</li>
              </ul>
            </div>
          </Card>
        </div>
      </Section>

      <Section title="Nav tab (active / inactive)">
        <div className="flex gap-4 rounded-lg border border-border bg-surface p-4 text-sm">
          <span className="border-b-2 border-brand px-1 py-2 font-semibold text-brand" aria-current="page">
            Active tab
          </span>
          <span className="border-b-2 border-transparent px-1 py-2 font-medium text-ink-muted">
            Inactive tab
          </span>
        </div>
      </Section>

      <Section title="Button variants -- enabled">
        <div className="flex flex-wrap gap-3">
          {BUTTON_VARIANTS.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
        </div>
      </Section>

      <Section title="Button variants -- disabled">
        <div className="flex flex-wrap gap-3">
          {BUTTON_VARIANTS.map((variant) => (
            <Button key={variant} variant={variant} disabled>
              {variant} (disabled)
            </Button>
          ))}
        </div>
      </Section>

      <Section title="Button variants -- loading">
        <div className="flex flex-wrap gap-3">
          {BUTTON_VARIANTS.map((variant) => (
            <Button key={variant} variant={variant} loading loadingText="Loading...">
              {variant}
            </Button>
          ))}
        </div>
      </Section>

      <Section title="Alert variants">
        <div className="flex flex-col gap-3">
          {ALERT_VARIANTS.map((variant) => (
            <Alert key={variant} variant={variant}>
              This is a {variant} alert.
            </Alert>
          ))}
        </div>
      </Section>

      <Section title="Card">
        <Card>
          <p className="text-sm text-ink">A basic Card with some sample content.</p>
        </Card>
      </Section>

      <Section title="Skeleton (loading placeholders)">
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </Section>

      <Section title="Items as cards (below the sm breakpoint)">
        <ul className="flex max-w-xs flex-col gap-2">
          {[
            { name: 'Milk', quantity: 2, unit_price: '2.50', line_total: '5.00' },
            { name: 'Bread', quantity: 1, unit_price: '3.00', line_total: '3.00' },
          ].map((item) => (
            <li key={item.name} className="rounded-md border border-border p-3">
              <p className="font-medium text-ink">{item.name}</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-ink-muted">Qty</dt>
                <dd className="text-right tabular-nums">{item.quantity}</dd>
                <dt className="whitespace-nowrap text-ink-muted">Unit price (USD)</dt>
                <dd className="whitespace-nowrap text-right tabular-nums">{item.unit_price}</dd>
                <dt className="whitespace-nowrap text-ink-muted">Line total (USD)</dt>
                <dd className="whitespace-nowrap text-right tabular-nums">{item.line_total}</dd>
              </dl>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Data-quality warnings, Edited badge and reset confirmation">
        <Alert variant="warning">
          <div className="flex gap-2">
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 flex-shrink-0" fill="none">
              <path
                d="M10 3.5l8 13.5H2l8-13.5z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path d="M10 8.5v3.5M10 14.75h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <div>
              <p className="font-semibold">Check these values</p>
              <ul className="mt-1 flex flex-col gap-1.5 list-disc pl-4">
                <li className="flex flex-wrap items-center gap-2">
                  <span>The total (79.40) does not match the items, discounts and tax (69.40 + 0.00).</span>
                  <Button variant="secondary" size="sm">
                    Fix in Edit
                  </Button>
                </li>
                <li className="flex flex-wrap items-center gap-2">
                  <span>The purchase date is missing.</span>
                  <Button variant="secondary" size="sm">
                    Fix in Edit
                  </Button>
                </li>
              </ul>
            </div>
          </div>
        </Alert>

        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface p-4">
          <h3 className="text-lg font-bold text-ink">
            Corner Store
            <span
              className="ml-2 inline-flex items-center rounded-full bg-warning-soft px-2 py-0.5 align-middle text-xs font-medium text-warning"
              title="Edited 2026-01-16T09:00:00+00:00"
            >
              Edited
            </span>
          </h3>
        </div>

        <Alert variant="warning">
          <div className="flex flex-col gap-3">
            <p>Replace your edits with the original AI result? This cannot be undone.</p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm">
                Yes, reset
              </Button>
              <Button variant="secondary" size="sm">
                Cancel
              </Button>
            </div>
          </div>
        </Alert>
      </Section>

      <Section title="Receipt meta line: a raw/unrecognized date, and Discounts/Taxes with the currency in the heading">
        <Card className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-medium text-ink">Store name</p>
            <p className="mt-1 inline-flex items-center gap-1 text-sm text-ink-muted" title="This date could not be read as a valid date. Open the receipt and fix it with Edit.">
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 flex-shrink-0 text-warning" fill="none">
                <path d="M10 3.5l8 13.5H2l8-13.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M10 8.5v3.5M10 11.75h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              26/06/2025
              <span className="sr-only">Date not recognized</span>
              <span>· USD</span>
            </p>
          </div>
          <div className="flex flex-col gap-3 text-sm">
            <div>
              <h2 className="font-medium text-ink-muted">Discounts (USD)</h2>
              <ul className="flex flex-col gap-1">
                <li className="flex items-baseline justify-between gap-4">
                  <span>Loyalty discount</span>
                  <span className="whitespace-nowrap text-right tabular-nums">0.50</span>
                </li>
              </ul>
            </div>
            <div>
              <h2 className="font-medium text-ink-muted">Taxes (USD)</h2>
              <ul className="flex flex-col gap-1">
                <li className="flex items-baseline justify-between gap-4">
                  <span>Sales tax</span>
                  <span className="whitespace-nowrap text-right tabular-nums">0.64</span>
                </li>
              </ul>
            </div>
          </div>
        </Card>
      </Section>

      <Section title="Apartment choice (RadioCardGroup -- none chosen / chosen / loading / failure)">
        <Card className="flex flex-col gap-4">
          <RadioCardGroup
            legend="Which apartment is this receipt for?"
            name="styleguide-apartment"
            options={SAMPLE_APARTMENT_OPTIONS}
            value={apartmentChoice}
            onChange={setApartmentChoice}
          />
          <p className="text-sm text-ink-muted">
            {apartmentChoice ? `Chosen: ${apartmentChoice}` : 'Choose an apartment to continue.'}
          </p>
        </Card>

        <div role="status" aria-busy="true" className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
          <span className="text-sm text-ink-muted">Loading apartments...</span>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Skeleton className="h-11 flex-1" />
            <Skeleton className="h-11 flex-1" />
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
          <Alert variant="error">Could not load apartments. Please try again.</Alert>
          <Button variant="secondary" size="sm" className="self-start">
            Retry
          </Button>
        </div>
      </Section>

      <Section title="Apartment on a saved receipt (ReceiptApartment -- two-line short name/place, selected / none / saving / saved / error)">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setReceiptApartmentState('selected')}>
            Show selected
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setReceiptApartmentState('none')}>
            Show none selected
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setReceiptApartmentState('saving')}>
            Show saving
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setReceiptApartmentState('saved')}>
            Show saved
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setReceiptApartmentState('error')}>
            Show error
          </Button>
        </div>

        <Card className="flex flex-col gap-2">
          <RadioCardGroup
            legend="Apartment"
            name="styleguide-receipt-apartment"
            options={TWO_LINE_APARTMENT_OPTIONS}
            value={receiptApartmentState === 'none' ? null : TWO_LINE_APARTMENT_OPTIONS[0].value}
            onChange={() => {}}
            disabled={receiptApartmentState === 'saving'}
          />
          {receiptApartmentState === 'saving' && (
            <p className="text-sm text-ink-muted">Saving...</p>
          )}
          {receiptApartmentState === 'saved' && (
            <p role="status" className="text-sm text-success">
              Saved
            </p>
          )}
          {receiptApartmentState === 'error' && (
            <Alert variant="error">Could not update the apartment. Please try again.</Alert>
          )}
        </Card>
      </Section>

      <Section title="Review status (ReceiptReviewStatus -- needs review / approved / saving / approval blocked)">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setReceiptStatusState('needs_review')}>
            Show needs review
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setReceiptStatusState('approved')}>
            Show approved
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setReceiptStatusState('saving')}>
            Show saving
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setReceiptStatusState('blocked')}>
            Show approval blocked
          </Button>
        </div>

        <Card className="flex flex-col gap-2">
          <span className="text-sm font-medium text-ink">Status</span>
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={receiptStatusState === 'approved' ? 'approved' : 'needs_review'} />
            {(() => {
              const isSaving = receiptStatusState === 'saving'
              return receiptStatusState === 'approved' ? (
                <Button variant="secondary" size="sm" disabled={isSaving}>
                  Back to needs review
                </Button>
              ) : (
                <Button variant="primary" size="sm" disabled={isSaving}>
                  Mark as approved
                </Button>
              )
            })()}
          </div>
          {receiptStatusState === 'saving' && <p className="text-sm text-ink-muted">Saving...</p>}
          {receiptStatusState === 'blocked' && (
            <Alert variant="error">
              To approve this receipt, also set: apartment, a valid purchase date. You can fix the date
              with Edit.
            </Alert>
          )}
        </Card>
      </Section>

      <Section title="Review bar (ReviewBar -- the saved-receipt view's main action, moved to the top of the data column)">
        <p className="text-sm text-ink-muted">
          From `lg` up it sticks under the header while the data column scrolls past it (left sample);
          below `lg` it instead sticks to the bottom of the viewport (right sample). Only one variant is
          ever mounted for a given screen size -- these two static samples are shown side by side only
          for comparison here.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-ink">`lg` and up: sticky under the header</h3>
            <div className="rounded-card border border-border-subtle bg-surface px-4 py-3 shadow-card">
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status="needs_review" />
                <Button variant="primary" size="sm">
                  Mark as approved
                </Button>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-ink">Below `lg`: fixed to the bottom of the viewport</h3>
            <div className="border-t border-border bg-surface px-4 py-3 shadow-popover">
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status="approved" />
                <Button variant="secondary" size="sm">
                  Back to needs review
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section title='Review mode (ReviewBar -- position, Previous/Next and "Approve and next", shown only when opened from a filtered history list)'>
        <p className="text-sm text-ink-muted">
          Shown only when the receipt was opened from a history list with a tab/filter active (so a
          snapshot of up to 200 matching receipts could be fetched) and this receipt is in it; otherwise
          ReviewBar looks exactly like the sample above with no position/Previous/Next/"Approve and next".
        </p>
        <div className="rounded-card border border-border-subtle bg-surface px-4 py-3 shadow-card">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status="needs_review" />
              <Button variant="primary" size="sm">
                Mark as approved
              </Button>
              <Button variant="primary" size="sm">
                Approve and next
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <p role="status" className="text-ink-muted">
                2 of 5
              </p>
              <span className="font-medium text-brand hover:underline">Previous</span>
              <span className="font-medium text-brand hover:underline">Next</span>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Compact History rows (HistoryRow -- normal/unrecognized/missing date, long store name, All tab vs. a filtered tab)">
        <ul className="flex flex-col gap-2">
          <HistoryRow
            item={{
              receipt_id: 'sg-1',
              original_filename: 'a.jpg',
              store_name: 'Corner Store',
              purchase_date: '2026-01-15',
              currency: 'USD',
              total: 10,
              created_at: '2026-01-15T00:00:00+00:00',
              apartment_id: 'oberaudorf-bergblick',
              apartment_name: 'Fewo JoJo - Oberaudorf - Bergblick',
              status: 'approved',
            }}
            href="#"
            onOpen={() => {}}
            showApartmentBadge
            showStatusBadge
            isSmallScreen={false}
          />
          <HistoryRow
            item={{
              receipt_id: 'sg-2',
              original_filename: 'b.jpg',
              store_name: 'A receipt with an unrecognized date',
              purchase_date: '02 Juni 2026',
              currency: 'USD',
              total: 20,
              created_at: '2026-01-14T00:00:00+00:00',
              apartment_id: null,
              apartment_name: null,
              status: 'needs_review',
            }}
            href="#"
            onOpen={() => {}}
            showApartmentBadge
            showStatusBadge
            isSmallScreen={false}
          />
          <HistoryRow
            item={{
              receipt_id: 'sg-3',
              original_filename: 'c.jpg',
              store_name:
                'A very long store name that needs to be clamped to one line instead of wrapping and growing the row',
              purchase_date: null,
              currency: 'USD',
              total: 30,
              created_at: '2026-01-13T00:00:00+00:00',
              apartment_id: null,
              apartment_name: null,
              status: 'needs_review',
            }}
            href="#"
            onOpen={() => {}}
            showApartmentBadge={false}
            showStatusBadge={false}
            isSmallScreen={false}
          />
        </ul>
        <p className="text-sm text-ink-muted">
          The first row (All apartments, Status "All") shows both badges; the second shows the raw,
          unrecognized date with the same warning marker the Items view uses; the third demonstrates a
          clamped long store name with no badges -- as they would appear inside a specific apartment tab
          with a Status filter active.
        </p>
      </Section>

      <Section title="History tab bar and filters (ReceiptHistory -- All apartments / one apartment selected)">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setHistoryTab('all')}>
            Show "All apartments" selected
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setHistoryTab('oberaudorf')}>
            Show an apartment tab selected
          </Button>
        </div>

        <Card className="flex flex-col gap-4">
          <div
            role="tablist"
            aria-label="Apartment"
            className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1"
          >
            {[
              { id: 'all', label: 'All apartments (3)' },
              { id: 'oberaudorf', label: `${SAMPLE_APARTMENT_OPTIONS[0].label} (2)` },
              { id: 'waldglueck', label: `${SAMPLE_APARTMENT_OPTIONS[1].label} (1)` },
            ].map((tab) => {
              const selected = tab.id === historyTab
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setHistoryTab(tab.id as 'all' | 'oberaudorf')}
                  className={`min-h-[44px] flex-1 rounded-md px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                    selected ? 'bg-white font-semibold text-brand shadow-sm' : 'font-medium text-ink-muted'
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor="styleguide-history-year" className="text-sm font-medium text-ink">
                Year
              </label>
              <select
                id="styleguide-history-year"
                onChange={() => {}}
                className="h-11 min-h-[44px] rounded-md border border-border bg-surface px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <option value="">All years</option>
                <option value="2026">2026</option>
                <option value="2025">2025</option>
                <option value="none">No valid date</option>
              </select>
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor="styleguide-history-status" className="text-sm font-medium text-ink">
                Status
              </label>
              <select
                id="styleguide-history-status"
                onChange={() => {}}
                className="h-11 min-h-[44px] rounded-md border border-border bg-surface px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <option value="">All</option>
                <option value="needs_review">Needs review</option>
                <option value="approved">Approved</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <p role="status" className="text-sm text-ink-muted">
              {historyTab === 'all' ? '3 receipts' : '2 receipts'}
            </p>
            <Button variant="secondary" size="sm">
              Clear filters
            </Button>
          </div>
        </Card>
      </Section>

      <Section title="Dropzone (idle / drag-over / file-selected)">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setDropzoneState('idle')}>
            Show idle
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setDropzoneState('drag-over')}>
            Show drag-over
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setDropzoneState('file-selected')}>
            Show file-selected
          </Button>
        </div>

        <Card className="flex flex-col gap-4">
          <div
            className={`flex flex-col items-center gap-2 rounded-control border-2 border-dashed p-8 text-center ${
              dropzoneState === 'drag-over' ? 'border-brand bg-brand-subtle' : 'border-border bg-brand-soft'
            }`}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-8 w-8 text-brand" fill="none">
              <path
                d="M12 16V4m0 0L7 9m5-5l5 5M5 20h14"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <p className="text-sm font-medium text-ink">Drag a receipt here, or</p>
            <Button variant="secondary" size="sm">
              Browse files
            </Button>
            <p className="text-sm text-ink-muted">JPG, PNG or PDF, up to 10 MB</p>
          </div>

          {dropzoneState === 'file-selected' && (
            <div className="flex items-center gap-3 rounded-md border border-border bg-surface-page px-3 py-2">
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                Selected file: sample-receipt.jpg (120 KB)
              </p>
              <Button variant="ghost" size="sm">
                Remove
              </Button>
            </div>
          )}
        </Card>
      </Section>

      <Section title="Upload form status line (neither / only file / only apartment missing -- aria-describedby on the submit button)">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setUploadHelperState('neither')}>
            Show: neither chosen
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setUploadHelperState('file-only')}>
            Show: apartment chosen, no file
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setUploadHelperState('apartment-only')}>
            Show: file chosen, no apartment
          </Button>
        </div>
        <Card className="flex flex-col gap-2">
          <Button disabled>Read receipt</Button>
          {uploadHelperState === 'neither' && (
            <p className="text-sm text-ink-muted">Choose an apartment and add a receipt to continue.</p>
          )}
          {uploadHelperState === 'file-only' && (
            <p className="text-sm text-ink-muted">Choose a file to continue.</p>
          )}
          {uploadHelperState === 'apartment-only' && (
            <p className="text-sm text-ink-muted">Choose an apartment to continue.</p>
          )}
        </Card>
      </Section>

      <Section title="Batch upload queue (BatchQueue -- compact rows: waiting / in progress / done with warnings / failed / rejected files)">
        <Card className="flex flex-col gap-4">
          <BatchQueue
            items={SAMPLE_BATCH_ITEMS}
            rejected={SAMPLE_BATCH_REJECTED}
            onRetry={() => {}}
            onRemove={() => {}}
          />
        </Card>
      </Section>

      <Section title="Batch summary line and sticky action bar (ReceiptUpload batch mode)">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setBatchSummaryState('before-start')}>
            Show before start (summary line)
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setBatchSummaryState('running')}>
            Show after start (progress)
          </Button>
        </div>

        <Card className="relative flex max-h-56 flex-col gap-2 overflow-y-auto p-0">
          <ul className="flex flex-col gap-2 p-4">
            <li className="rounded-md border border-border bg-surface-page px-3 py-2 text-sm text-ink-muted">
              Row 1 (scrolls behind the sticky bar below)
            </li>
            <li className="rounded-md border border-border bg-surface-page px-3 py-2 text-sm text-ink-muted">
              Row 2
            </li>
            <li className="rounded-md border border-border bg-surface-page px-3 py-2 text-sm text-ink-muted">
              Row 3
            </li>
          </ul>

          <div className="sticky bottom-0 flex flex-col gap-3 border-t border-border bg-surface px-4 py-3">
            {batchSummaryState === 'running' ? (
              <div className="flex flex-col gap-1">
                <label htmlFor="styleguide-batch-progress" className="text-sm font-medium text-ink">
                  Batch progress
                </label>
                <progress id="styleguide-batch-progress" value={1} max={3} className="h-2 w-full accent-brand" />
                <p role="status" className="text-sm text-ink-muted">
                  1 of 3 read, 0 failed
                </p>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">3 receipts · 1.2 MB · for Waldglück</p>
            )}
            {batchSummaryState === 'running' ? (
              <Button variant="secondary" size="sm" className="self-start">
                Stop
              </Button>
            ) : (
              <>
                <Button className="self-start">Read 3 receipts</Button>
                <p className="flex items-start gap-1.5 text-sm text-ink-muted">
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 flex-shrink-0" fill="none">
                    <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M10 9v4.5M10 6.75h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  Each receipt is sent to OpenAI to read it (3 requests).
                </p>
              </>
            )}
          </div>
        </Card>
      </Section>

      <Section title="Reading tips (collapsible, under the dropzone)">
        <Card className="flex flex-col gap-4">
          <details className="rounded-md border border-border px-3 py-2 text-sm text-ink-muted">
            <summary className="cursor-pointer select-none font-medium text-ink">
              Tips for better reading
            </summary>
            <ul className="mt-2 flex flex-col gap-1 pl-4 list-disc">
              <li>Lay the receipt flat.</li>
              <li>Use good light.</li>
              <li>Keep the whole receipt in frame, including the total.</li>
              <li>One receipt per photo.</li>
            </ul>
          </details>
        </Card>
      </Section>

      <Section title="Batch paused / finished (ReceiptUpload batch mode)">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setBatchPauseState('unavailable')}>
            Show paused (unavailable)
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setBatchPauseState('network')}>
            Show paused (network)
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setBatchPauseState('stopped')}>
            Show paused (stopped)
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setBatchPauseState('finished')}>
            Show finished
          </Button>
        </div>

        <Card className="flex flex-col gap-3">
          {batchPauseState === 'finished' ? (
            <>
              <Alert variant="success">Done: 3 read, 1 failed.</Alert>
              <div className="flex gap-2">
                <Button size="sm">Review in History</Button>
                <Button variant="secondary" size="sm">
                  Read more receipts
                </Button>
              </div>
            </>
          ) : (
            <>
              <Alert variant={batchPauseState === 'stopped' ? 'warning' : 'error'}>
                {batchPauseState === 'unavailable'
                  ? EXTRACTION_NOT_CONFIGURED_MESSAGE
                  : batchPauseState === 'network'
                    ? NETWORK_ERROR_MESSAGE
                    : 'Stopped. The remaining receipts were not processed.'}
              </Alert>
              <Button size="sm" className="self-start">
                Resume
              </Button>
            </>
          )}
        </Card>
      </Section>

      <Section title="Items view (ReceiptItems -- loading / table with nulls / cards / empty / error / Show more)">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setItemsViewState('loading')}>
            Show loading
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setItemsViewState('table')}>
            Show table (All apartments, one row with nulls)
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setItemsViewState('cards')}>
            Show cards (below sm)
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setItemsViewState('empty-unfiltered')}>
            Show empty (unfiltered)
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setItemsViewState('empty-filtered')}>
            Show empty (filtered)
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setItemsViewState('error')}>
            Show error
          </Button>
        </div>

        <div className="flex flex-col gap-1 sm:w-48">
          <label htmlFor="styleguide-items-sort" className="text-sm font-medium text-ink">
            Sort by
          </label>
          <select
            id="styleguide-items-sort"
            value={itemsSortSample}
            onChange={(e) => setItemsSortSample(e.target.value)}
            className="h-11 min-h-[44px] rounded-md border border-border bg-surface px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <option value="date_desc">Date (newest first)</option>
            <option value="date_asc">Date (oldest first)</option>
            <option value="amount_desc">Amount (high to low)</option>
            <option value="amount_asc">Amount (low to high)</option>
            <option value="store">Store (A-Z)</option>
          </select>
        </div>

        <Card className="flex flex-col gap-4">
          {itemsViewState === 'loading' && (
            <div role="status" aria-busy="true" className="flex flex-col gap-3">
              <span className="sr-only">Loading items...</span>
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {itemsViewState === 'error' && (
            <>
              <Alert variant="error">Could not load items. Please try again.</Alert>
              <Button variant="secondary" size="sm" className="self-start">
                Retry
              </Button>
            </>
          )}

          {itemsViewState === 'empty-unfiltered' && (
            <p className="text-sm text-ink-muted">No items yet. Upload a receipt.</p>
          )}

          {itemsViewState === 'empty-filtered' && (
            <>
              <p className="text-sm text-ink-muted">No items match these filters.</p>
              <Button variant="secondary" size="sm" className="self-start">
                Clear filters
              </Button>
            </>
          )}

          {itemsViewState === 'table' && (
            <div className="overflow-x-auto">
              <table className="w-full table-fixed text-left text-sm">
                <caption className="sr-only">Purchased items</caption>
                <thead>
                  <tr className="border-b border-border text-ink-muted">
                    <th scope="col" className="w-24 whitespace-nowrap py-2 pr-2 font-medium">
                      Date
                    </th>
                    <th scope="col" className="py-2 pr-2 font-medium">
                      Item
                    </th>
                    <th scope="col" className="w-16 py-2 pr-2 text-right font-medium">
                      Qty
                    </th>
                    <th scope="col" className="w-24 whitespace-nowrap py-2 pr-2 text-right font-medium">
                      Unit price
                    </th>
                    <th scope="col" className="w-24 whitespace-nowrap py-2 pr-2 text-right font-medium">
                      Line total
                    </th>
                    <th scope="col" className="w-40 py-2 pr-2 font-medium">
                      Store
                    </th>
                    <th scope="col" className="w-28 py-2 pr-2 font-medium">
                      Apartment
                    </th>
                    <th scope="col" className="w-28 py-2 font-medium">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {SAMPLE_ITEM_ROWS.map((row) => (
                    <tr key={row.receipt_id} className="border-b border-border/40 hover:bg-slate-50">
                      <td className="whitespace-nowrap py-2 pr-2">
                        <DateCell value={row.purchase_date} />
                      </td>
                      <td className="py-2 pr-2">
                        <a href="#" onClick={(e) => e.preventDefault()} className="inline-block font-medium text-ink underline hover:text-brand">
                          {row.name ? <ClampedText text={row.name} lines={2} /> : <MissingValue />}
                        </a>
                      </td>
                      <td className="whitespace-nowrap py-2 pr-2 text-right tabular-nums">
                        <QuantityCell value={row.quantity} />
                      </td>
                      <td className="whitespace-nowrap py-2 pr-2 text-right tabular-nums">
                        <MoneyCell value={row.unit_price} currency={row.currency} />
                      </td>
                      <td className="whitespace-nowrap py-2 pr-2 text-right tabular-nums">
                        <MoneyCell value={row.line_total} currency={row.currency} />
                      </td>
                      <td className="py-2 pr-2">
                        <StoreCell value={row.store_name} />
                      </td>
                      <td className="py-2 pr-2">
                        <ApartmentCell name={row.apartment_name} />
                      </td>
                      <td className="py-2">
                        <StatusCell status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p role="status" className="mt-3 text-sm text-ink-muted">
                2 of 5 items
              </p>
              <Button variant="secondary" size="sm" className="mt-1 self-start">
                Show more
              </Button>
            </div>
          )}

          {itemsViewState === 'cards' && (
            <ul className="flex flex-col gap-2">
              {SAMPLE_ITEM_ROWS.map((row) => (
                <li key={row.receipt_id} className="rounded-md border border-border p-3">
                  <a href="#" onClick={(e) => e.preventDefault()} className="inline-block font-medium text-ink underline hover:text-brand">
                    {row.name ? <ClampedText text={row.name} lines={2} /> : <MissingValue />}
                  </a>
                  <p className="mt-1 flex items-center gap-1 text-sm text-ink-muted">
                    <DateCell value={row.purchase_date} /> <span aria-hidden="true">·</span>{' '}
                    {row.store_name ? row.store_name : <MissingValue />}
                  </p>
                  <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span>
                      Qty <span className="tabular-nums"><QuantityCell value={row.quantity} /></span>
                    </span>
                    <span className="whitespace-nowrap">
                      Unit price{' '}
                      <span className="tabular-nums">
                        <MoneyCell value={row.unit_price} currency={row.currency} />
                      </span>
                    </span>
                    <span className="whitespace-nowrap">
                      Line total{' '}
                      <span className="tabular-nums">
                        <MoneyCell value={row.line_total} currency={row.currency} />
                      </span>
                    </span>
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <ApartmentCell name={row.apartment_name} />
                    <StatusCell status={row.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>
    </div>
  )
}

export default StyleGuide
