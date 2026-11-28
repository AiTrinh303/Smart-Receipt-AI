import { useState } from 'react'
import type { ReactNode } from 'react'
import Alert from './components/ui/Alert'
import Button from './components/ui/Button'
import Card from './components/ui/Card'
import PageHeader from './components/ui/PageHeader'
import { ApartmentDot, ApartmentPill } from './components/ui/ApartmentTone'
import Pagination from './components/ui/Pagination'
import RadioCardGroup from './components/ui/RadioCardGroup'
import Select from './components/ui/Select'
import Skeleton from './components/ui/Skeleton'
import StatusBadge from './components/ui/StatusBadge'
import BatchQueue from './batch/BatchQueue'
import { MAX_BATCH } from './batch/batchReducer'
import type { BatchItem, RejectedFile } from './batch/batchReducer'
import { EXTRACTION_FAILED_MESSAGE, EXTRACTION_NOT_CONFIGURED_MESSAGE, NETWORK_ERROR_MESSAGE } from './errorMessages'
import { ItemCardList, ItemsSearchField, ItemsTable } from './ReceiptItems'
import { HistoryHeaderRow, HistoryRow, HistoryRowList } from './ReceiptHistory'
import ReceiptFileViewer from './ReceiptFileViewer'
import { ExportCard, VAT_FOOTNOTE } from './ReceiptReport'
import { exportOpenItems } from './reportOpenItems'
import { HelpPanel, ReceiptsOverview, UploadSidePanelSkeleton } from './UploadSidePanel'
import type { ItemRow, ReceiptSummary, YearlyReport } from './api/types'
import { formatMoneyFromString } from './components/ui/formatMoney'
import { apartmentToneClasses } from './format/apartmentTone'
import { RECEIPT_SORT_OPTIONS } from './historySort'

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

const SAMPLE_EXISTING_RECEIPT: ReceiptSummary = {
  receipt_id: 'sample-existing-receipt-id',
  original_filename: 'receipt.jpg',
  store_name: 'Corner Store',
  purchase_date: '2026-01-15',
  currency: 'EUR',
  total: 19.99,
  created_at: '2026-01-15T10:00:00+00:00',
  apartment_id: 'oberaudorf-bergblick',
  apartment_name: 'Fewo JoJo - Oberaudorf - Bergblick',
  status: 'needs_review',
}

function sampleLatest(id: string, overrides: Partial<ReceiptSummary>): ReceiptSummary {
  return {
    receipt_id: id,
    original_filename: 'receipt.jpg',
    store_name: 'Edeka Center Sankt Englmar',
    purchase_date: '2026-11-20',
    currency: 'EUR',
    total: 23.5,
    created_at: '2026-11-25T10:00:00Z',
    apartment_id: 'sankt-englmar-waldglueck',
    apartment_name: 'Fewo JoJo - Sankt Englmar - Waldglück',
    status: 'needs_review',
    ...overrides,
  }
}

const SAMPLE_SIDE_PANEL_LATEST: ReceiptSummary[] = [
  sampleLatest('sample-latest-1', {}),
  sampleLatest('sample-latest-2', {
    store_name: 'Bauhaus Fachcentrum für Werkstatt, Haus und Garten Rosenheim',
    total: 1249.9,
    apartment_id: 'oberaudorf-bergblick',
    apartment_name: 'Fewo JoJo - Oberaudorf - Bergblick',
  }),
  sampleLatest('sample-latest-3', { store_name: null, purchase_date: '26/06/2025', total: null }),
  sampleLatest('sample-latest-4', { store_name: 'dm', purchase_date: null, apartment_id: null, apartment_name: null }),
  sampleLatest('sample-latest-5', { store_name: 'Rewe', total: 7.89 }),
]

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
    extracted: { store_name: 'Edeka Center Sankt Englmar', purchase_date: '2026-11-20', total: 23.5, currency: 'EUR' },
  },
  {
    id: 'batch-sample-4b',
    file: new File([], 'receipt-4b.jpg'),
    status: 'done',
    receiptId: 'sample-receipt-id-2',
    extracted: { store_name: null, purchase_date: '26/06/2025', total: null, currency: null },
  },
  {
    id: 'batch-sample-5',
    file: new File([], 'receipt-5.jpg'),
    status: 'failed',
    error: EXTRACTION_FAILED_MESSAGE,
    errorKind: 'unreadable',
  },
  {
    id: 'batch-sample-6',
    file: new File([], 'receipt-6.jpg'),
    status: 'skipped',
    errorKind: 'duplicate',
    existing: SAMPLE_EXISTING_RECEIPT,
  },
  {
    id: 'batch-sample-7',
    file: new File([], 'receipt-7.jpg'),
    status: 'skipped',
    errorKind: 'duplicate_in_batch',
  },
]

const SAMPLE_ITEM_ROWS: ItemRow[] = [
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
    apartment_id: 'oberaudorf-bergblick',
    apartment_name: 'Fewo JoJo - Oberaudorf - Bergblick',
    status: 'needs_review' as const,
  },
  {
    // A second line of the same receipt: shares the light divider with the
    // row above; the next row (another receipt) starts with a stronger one.
    receipt_id: 'sample-normal',
    line_index: 1,
    name: 'Bread',
    quantity: 1,
    unit_price: 2.29,
    line_total: 2.29,
    currency: 'EUR',
    purchase_date: '2026-01-15',
    store_name: 'Corner Store',
    apartment_id: 'oberaudorf-bergblick',
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
    apartment_id: 'sankt-englmar-waldglueck',
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
    apartment_id: null,
    apartment_name: null,
    // Deliberately not a valid status, to show StatusCell's MissingValue
    // fallback (the API type never allows this; the sample does on purpose).
    status: null as unknown as ItemRow['status'],
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
    apartment_id: 'oberaudorf-bergblick',
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
    apartment_id: 'sankt-englmar-waldglueck',
    apartment_name: 'Fewo JoJo - Sankt Englmar - Waldglück',
    status: 'approved' as const,
  },
]

/** Inline SVG "receipts" for the file viewer samples: a tall portrait one,
 * and the same shape turned sideways (text running bottom-to-top), so
 * Rotate can be tried without a backend. No real store or amount. */
const SAMPLE_RECEIPT_LINES = Array.from({ length: 8 }, (_, i) => `<rect x="30" y="${120 + i * 50}" width="${i % 3 === 0 ? 240 : 180}" height="14" rx="3" fill="#cbd5e1"/>`).join('')
const SAMPLE_PORTRAIT_RECEIPT_URL = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="600" viewBox="0 0 300 600"><rect width="300" height="600" fill="#ffffff"/><rect x="30" y="40" width="160" height="28" rx="4" fill="#94a3b8"/>${SAMPLE_RECEIPT_LINES}<rect x="30" y="540" width="240" height="20" rx="3" fill="#64748b"/></svg>`,
)}`
const SAMPLE_SIDEWAYS_RECEIPT_URL = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300" viewBox="0 0 600 300"><g transform="translate(0 300) rotate(-90)"><rect width="300" height="600" fill="#ffffff"/><rect x="30" y="40" width="160" height="28" rx="4" fill="#94a3b8"/>${SAMPLE_RECEIPT_LINES}<rect x="30" y="540" width="240" height="20" rx="3" fill="#64748b"/></g></svg>`,
)}`

const SAMPLE_EXPORT_APARTMENTS = [
  { id: 'oberaudorf-bergblick', name: 'Fewo JoJo - Oberaudorf - Bergblick' },
  { id: 'sankt-englmar-waldglueck', name: 'Fewo JoJo - Sankt Englmar - Waldglück' },
]

const SAMPLE_REPORT_ALL_CLEAR: YearlyReport = {
  year: 2026,
  basis: 'all',
  apartments: [],
  overall: [],
  excluded: { undated: 0, not_approved: 0, no_total: 0, no_currency: 0, no_apartment: 0 },
  with_warnings: 0,
  counted_unreviewed: 0,
  attention: [],
  possible_duplicates: [],
  possible_duplicate_groups: 0,
  largest: [],
}

const SAMPLE_REPORT_WITH_CHECKS: YearlyReport = {
  ...SAMPLE_REPORT_ALL_CLEAR,
  excluded: { undated: 2, not_approved: 0, no_total: 1, no_currency: 0, no_apartment: 0 },
  with_warnings: 2,
  counted_unreviewed: 5,
  attention: [
    {
      receipt_id: 'sample-attention-1',
      store_name: 'Corner Store',
      purchase_date: '2026-01-15',
      total: '19.99',
      currency: 'EUR',
      apartment_id: 'oberaudorf-bergblick',
      warning_codes: ['TOTAL_MISMATCH'],
    },
  ],
  possible_duplicates: [
    {
      receipt_ids: ['sample-dup-1', 'sample-dup-2'],
      store_name: 'Bakery',
      purchase_date: '2026-02-01',
      total: '1000.00',
      currency: 'EUR',
      apartment_id: 'sankt-englmar-waldglueck',
    },
  ],
  possible_duplicate_groups: 1,
}

const HISTORY_SAMPLE_BASE = {
  original_filename: 'a.jpg',
  currency: 'EUR',
  created_at: '2026-01-15T00:00:00+00:00',
}

const HISTORY_SAMPLE_ROWS: { item: ReceiptSummary; showApartmentBadge: boolean; showStatusBadge: boolean }[] = [
  {
    item: {
      ...HISTORY_SAMPLE_BASE,
      receipt_id: 'sg-1',
      store_name: 'Corner Store',
      purchase_date: '2026-01-15',
      total: 10,
      apartment_id: 'oberaudorf-bergblick',
      apartment_name: 'Fewo JoJo - Oberaudorf - Bergblick',
      status: 'approved',
    },
    showApartmentBadge: true,
    showStatusBadge: true,
  },
  {
    item: {
      ...HISTORY_SAMPLE_BASE,
      receipt_id: 'sg-2',
      store_name: 'A receipt with an unrecognized date',
      purchase_date: '27.06.26 09:52',
      total: 1234.5,
      apartment_id: 'sankt-englmar-waldglueck',
      apartment_name: 'Fewo JoJo - Sankt Englmar - Waldglück',
      status: 'needs_review',
    },
    showApartmentBadge: true,
    showStatusBadge: true,
  },
  {
    item: {
      ...HISTORY_SAMPLE_BASE,
      receipt_id: 'sg-3',
      store_name: 'Bakery',
      currency: 'USD',
      purchase_date: null,
      total: 3.2,
      apartment_id: null,
      apartment_name: null,
      status: 'needs_review',
    },
    showApartmentBadge: true,
    showStatusBadge: true,
  },
  {
    item: {
      ...HISTORY_SAMPLE_BASE,
      receipt_id: 'sg-4',
      store_name:
        'A very long store name that needs to be clamped to one line instead of wrapping and growing the row',
      purchase_date: '2026-01-13',
      total: 30,
      apartment_id: null,
      apartment_name: null,
      status: 'needs_review',
    },
    showApartmentBadge: false,
    showStatusBadge: false,
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
  const [sgItemsSearch, setSgItemsSearch] = useState('Kaffee')
  const [sgYear, setSgYear] = useState('')
  const [sgStatus, setSgStatus] = useState('')
  const [sgSort, setSgSort] = useState('date_desc')
  const [sgSelectClosed, setSgSelectClosed] = useState('date_desc')

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
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white"
            >
              2
            </span>
            <h2 className="text-base font-semibold text-ink">
              Receipts{' '}
              <span className="font-normal text-ink-muted" title="Fewo JoJo - Sankt Englmar - Waldglück">
                for Waldglück
              </span>
            </h2>
            <span className="text-xs text-ink-muted">(after choosing an apartment)</span>
          </div>
        </Card>
      </Section>

      <Section title="Upload side panel (from lg up only, stretched to the form's height -- loading / help, shown for 0 receipts or any load failure / overview for returning users: tips at the top, Latest uploads, links)">
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-ink">Loading</h3>
            <UploadSidePanelSkeleton />
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-ink">No receipts yet, or loading failed</h3>
            <HelpPanel />
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-ink">Returning user (missing values, unrecognized date)</h3>
            <ReceiptsOverview latest={SAMPLE_SIDE_PANEL_LATEST} />
          </div>
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
          {/* One icon only -- the Alert's own. */}
          <div>
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

      <Section title="Receipt meta line, Discounts/Taxes with the currency in the heading, empty Discounts as one line, and the Total row">
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
            <p className="text-ink-muted">Discounts (USD): None detected</p>
          </div>
          <p className="flex items-baseline justify-between gap-4 border-t border-border pt-3 text-lg font-bold text-ink">
            <span className="sr-only">Total: USD 8.14</span>
            <span aria-hidden="true">Total</span>
            <span aria-hidden="true" className="whitespace-nowrap text-right tabular-nums">
              USD 8.14
            </span>
          </p>
          <p className="text-sm text-ink-muted">
            The "Discounts (USD): None detected" line replaces the Discounts heading whenever a receipt has
            no discounts (shown here under a sample with one, for comparison).
          </p>
        </Card>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-1 py-2 text-sm font-medium text-ink-muted">
            Back to history
          </span>
          <button
            type="button"
            className="inline-flex min-h-[44px] items-center rounded-md px-1 text-sm font-medium text-brand underline hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:min-h-0 sm:py-2"
          >
            Upload another receipt
          </button>
        </div>
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

      <Section title="Apartment on a saved receipt (ReceiptApartment -- one compact line: short name only, full name in the tooltip; selected / none / saving / saved / error)">
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
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <RadioCardGroup
              layout="inline"
              legend="Apartment"
              name="styleguide-receipt-apartment"
              options={TWO_LINE_APARTMENT_OPTIONS.map(({ value, label, accessibleName }) => ({
                value,
                label,
                accessibleName,
              }))}
              value={receiptApartmentState === 'none' ? null : TWO_LINE_APARTMENT_OPTIONS[0].value}
              onChange={() => {}}
              disabled={receiptApartmentState === 'saving'}
            />
            {receiptApartmentState === 'saving' && <p className="text-sm text-ink-muted">Saving...</p>}
            {receiptApartmentState === 'saved' && (
              <p role="status" className="text-sm text-success">
                Saved
              </p>
            )}
          </div>
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
          In review mode "Approve and next" is the one primary button and comes first; "Mark as approved"
          is secondary (outside review mode it stays primary). "2 warnings to check" appears whenever a
          needs-review receipt has warnings (review mode or not): in the app it is a link that scrolls to
          and focuses the warning panel's "Check these values" line, and never blocks approving.
        </p>
        <div className="rounded-card border border-border-subtle bg-surface px-4 py-3 shadow-card">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status="needs_review" />
              <Button variant="primary" size="sm">
                Approve and next
              </Button>
              <Button variant="secondary" size="sm">
                Mark as approved
              </Button>
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-warning underline">
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 flex-shrink-0" fill="none">
                  <path d="M10 3.5l8 13.5H2l8-13.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  <path d="M10 8.5v3.5M10 14.75h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                2 warnings to check
              </span>
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

      <Section title="Receipt file viewer (one toolbar row, fixed height from lg up, working zoom, Rotate for images only)">
        <p className="text-sm text-ink-muted">
          One toolbar row: zoom out, zoom %, zoom in, Fit, Rotate on the left (images only); "Open original"
          (file name in its tooltip) and "Download PDF" on the right. In the narrow panel the links wrap to a
          second line, starting at the left. From lg up each viewer is calc(100vh - 6rem) tall and Fit shows
          the whole image; zoom in/out and scroll the image area both ways. Try Rotate on the sideways
          sample, then zoom. Static inline images stand in for saved files; the two links point at sample
          ids and won&apos;t work here.
        </p>
        <div className="flex flex-wrap items-start gap-6">
          <div className="flex w-[22rem] flex-col gap-2">
            <p className="text-sm font-medium text-ink">Narrow panel, portrait photo (links wrap)</p>
            <div>
              <ReceiptFileViewer
                receiptId="sg-viewer-1"
                fileName="a-long-original-file-name-from-the-phone.jpg"
                contentType="image/svg+xml"
                fileUrl={SAMPLE_PORTRAIT_RECEIPT_URL}
              />
            </div>
          </div>
          <div className="flex w-[28rem] flex-col gap-2">
            <p className="text-sm font-medium text-ink">Sideways photo (rotate once, then zoom)</p>
            <div>
              <ReceiptFileViewer
                receiptId="sg-viewer-2"
                fileName="sideways.jpg"
                contentType="image/svg+xml"
                fileUrl={SAMPLE_SIDEWAYS_RECEIPT_URL}
              />
            </div>
          </div>
          <div className="flex w-[22rem] flex-col gap-2">
            <p className="text-sm font-medium text-ink">PDF (no zoom, no Rotate)</p>
            <ReceiptFileViewer
              receiptId="sg-viewer-3"
              fileName="receipt.pdf"
              contentType="application/pdf"
              fileUrl="about:blank"
            />
          </div>
        </div>
      </Section>

      <Section title="Apartment tones (ApartmentPill / ApartmentDot -- sky, fuchsia, neutral)">
        <p className="text-sm text-ink-muted">
          One colour per apartment (src/format/apartmentTone.ts): Bergblick sky, Waldglück fuchsia, any other
          id neutral. Labels in lists are soft pills (History, Items, the upload side panel); tabs, the
          apartment choice cards and the report cards get a small dot before the name. The name is always
          visible text; the full name stays in the tooltip.
        </p>
        <Card className="flex flex-col gap-4">
          {[
            { id: 'oberaudorf-bergblick', name: 'Fewo JoJo - Oberaudorf - Bergblick', label: 'Bergblick (sky)' },
            { id: 'sankt-englmar-waldglueck', name: 'Fewo JoJo - Sankt Englmar - Waldglück', label: 'Waldglück (fuchsia)' },
            { id: 'some-other-apartment', name: 'Another apartment', label: 'Any other id (neutral)' },
          ].map((sample) => (
            <div key={sample.id} className="flex flex-wrap items-center gap-4">
              <span className="w-44 text-sm text-ink-muted">{sample.label}</span>
              <ApartmentPill apartmentId={sample.id} title={sample.name}>
                <span className="truncate">{sample.label.split(' (')[0]}</span>
              </ApartmentPill>
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink">
                <ApartmentDot apartmentId={sample.id} />
                {sample.label.split(' (')[0]}
              </span>
            </div>
          ))}
        </Card>
      </Section>

      <Section title="History rows (HistoryRowList + HistoryHeaderRow + HistoryRow -- one Card with dividers and a column header row from sm up; approved vs. needs review, unrecognized/missing date, long store name, All tab vs. a filtered tab, wide vs. small screen)">
        {[false, true].map((small) => (
          <div key={String(small)} className="flex flex-col gap-2">
            <p className="text-sm font-medium text-ink">{small ? 'Below sm (two lines)' : 'From sm up (fixed columns)'}</p>
            <HistoryRowList header={small ? undefined : <HistoryHeaderRow showApartment showStatus />}>
              {HISTORY_SAMPLE_ROWS.map(({ item, showApartmentBadge, showStatusBadge }) => (
                <li key={item.receipt_id}>
                  <HistoryRow
                    item={item}
                    href="#"
                    onOpen={() => {}}
                    showApartmentBadge={showApartmentBadge}
                    showStatusBadge={showStatusBadge}
                    isSmallScreen={small}
                  />
                </li>
              ))}
            </HistoryRowList>
          </div>
        ))}
        <p className="text-sm text-ink-muted">
          From sm up, a muted column header row (Store, Date, Total, Apartment, Status -- hidden from
          assistive tech) sits above the rows with the same widths; below sm there is none. Rows 1-3 are as
          in the "All apartments" tab with Status "All": the muted apartment (short name, full name in the
          tooltip) and a status badge for every receipt, approved or not. Total and Status are right-aligned,
          with extra space between Total and Apartment; EUR amounts read "€…", other currencies keep their
          code (row 3, USD). Row 2 shows an
          unrecognized date with the same warning marker the Items view uses, row 3 a missing date and a
          missing apartment. Row 4 is a clamped long store name inside a specific apartment tab with a
          Status filter active (no apartment, no status).
        </p>
      </Section>

      <Section title="History pages (Pagination -- 12 per page; first / a middle page / last; one page shows only &quot;N receipts&quot;)">
        <p className="text-sm text-ink-muted">
          Under the list: &quot;Showing a–b of N&quot; on the left, the pagination on the right. First, last,
          current and its two neighbours are shown, &quot;…&quot; for gaps; the current page is filled and bold
          and not a link. Below sm it becomes &quot;‹ Previous&quot;, &quot;Page N of M&quot;, &quot;Next ›&quot;.
          These samples don&apos;t navigate.
        </p>
        {[1, 5, 8].map((page) => (
          <div key={page} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-ink-muted">
              Showing {(page - 1) * 12 + 1}–{Math.min(page * 12, 89)} of 89
            </p>
            <Pagination currentPage={page} totalPages={8} hrefForPage={(n) => `#page-${n}`} onPageChange={() => {}} />
          </div>
        ))}
        <p className="text-sm text-ink-muted">One page only (no pagination): &quot;9 receipts&quot;</p>
      </Section>

      <Section title="Select (ui/Select -- closed / open with the selected option checked and another highlighted / long value / inactive vs. active filter; native select below sm)">
        <p className="text-sm text-ink-muted">
          A select-only combobox: the button shows the value; the listbox popover (rounded-card, border-subtle,
          shadow-popover, scrolls past max height) marks the selected option with a check and medium weight,
          and the highlighted one with a brand-soft background. Try it with the keyboard: Enter/Space/Alt+Down
          open, arrows/Home/End/letters move, Enter selects, Escape or Tab closes. Below sm (resize the window)
          the native select is rendered instead.
        </p>
        <div className="grid gap-6 md:grid-cols-3">
          <Select
            id="styleguide-select-closed"
            label="Closed"
            value={sgSelectClosed}
            onChange={setSgSelectClosed}
            options={RECEIPT_SORT_OPTIONS}
          />
          <div className="pb-72">
            <Select
              id="styleguide-select-open"
              label="Open (sample)"
              value="amount_desc"
              onChange={() => {}}
              options={RECEIPT_SORT_OPTIONS}
              defaultOpen
            />
          </div>
          <Select
            id="styleguide-select-long"
            label="Long value (truncated)"
            value="long"
            onChange={() => {}}
            options={[
              { value: 'long', label: 'A very long option label that has to be truncated in the button' },
              { value: 'short', label: 'Short' },
            ]}
          />
        </div>
        <p className="text-sm text-ink-muted">
          Filter state: while a filter's value is not its default, the closed control gets border-brand and
          bg-brand-soft -- the value text (&quot;2026&quot;, &quot;Approved&quot;) says which filter is set, so
          not colour alone. Sort by is an ordering, never shown as active.
        </p>
        <div className="grid gap-6 md:grid-cols-3">
          <Select
            id="styleguide-select-inactive"
            label="Year (inactive: All years)"
            value=""
            onChange={() => {}}
            options={[
              { value: '', label: 'All years' },
              { value: '2026', label: '2026' },
            ]}
          />
          <Select
            id="styleguide-select-active"
            label="Year (active: 2026)"
            value="2026"
            active
            onChange={() => {}}
            options={[
              { value: '', label: 'All years' },
              { value: '2026', label: '2026' },
            ]}
          />
          <Select
            id="styleguide-select-active-status"
            label="Status (active: Approved)"
            value="approved"
            active
            onChange={() => {}}
            options={[
              { value: '', label: 'All' },
              { value: 'needs_review', label: 'Needs review' },
              { value: 'approved', label: 'Approved' },
            ]}
          />
        </div>
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

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Select
              id="styleguide-history-year"
              label="Year"
              value={sgYear}
              active={sgYear !== ''}
              onChange={setSgYear}
              options={[
                { value: '', label: 'All years' },
                { value: '2026', label: '2026' },
                { value: '2025', label: '2025' },
                { value: 'none', label: 'No valid date' },
              ]}
            />
            <Select
              id="styleguide-history-status"
              label="Status"
              value={sgStatus}
              active={sgStatus !== ''}
              onChange={setSgStatus}
              options={[
                { value: '', label: 'All' },
                { value: 'needs_review', label: 'Needs review' },
                { value: 'approved', label: 'Approved' },
              ]}
            />
            <Select
              id="styleguide-history-sort"
              label="Sort by"
              value={sgSort}
              onChange={setSgSort}
              options={RECEIPT_SORT_OPTIONS}
            />
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
            <p className="text-sm font-medium text-ink">Drag receipts here, or</p>
            <Button variant="secondary" size="sm">
              Browse files
            </Button>
            <p className="text-sm text-ink-muted">JPG, PNG or PDF, up to 10 MB each. Up to {MAX_BATCH} files at once.</p>
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
            <p role="status" className="text-sm text-ink-muted">Choose an apartment and add a receipt to continue.</p>
          )}
          {uploadHelperState === 'file-only' && (
            <p role="status" className="text-sm text-ink-muted">Choose a file to continue.</p>
          )}
          {uploadHelperState === 'apartment-only' && (
            <p className="text-sm text-ink-muted">Choose an apartment to continue.</p>
          )}
        </Card>
      </Section>

      <Section title="Batch upload queue (BatchQueue -- compact rows: waiting / in progress / done with what was read, incl. warnings and missing values / failed / already saved / same file twice / rejected files)">
        <Card className="flex flex-col gap-4">
          <BatchQueue
            items={SAMPLE_BATCH_ITEMS}
            rejected={SAMPLE_BATCH_REJECTED}
            onRetry={() => {}}
            onRemove={() => {}}
            onUploadAnyway={() => {}}
          />
        </Card>
      </Section>

      <Section title="Batch duplicate-check states (ReceiptUpload batch mode)">
        <Card className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-ink">Checking for duplicates</h3>
          <p role="status" className="text-sm text-ink-muted">
            Checking for duplicates...
          </p>
        </Card>
        <Card className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-ink">Duplicate check request failed</h3>
          <p className="text-sm text-ink-muted">Could not check for duplicates before uploading.</p>
          <p className="text-sm text-ink-muted">5 receipts · 1.2 MB · for Waldglück</p>
        </Card>
        <Card className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-ink">All files are already saved (0 left to read)</h3>
          <Button disabled>Read 0 receipts</Button>
          <p className="text-sm text-ink-muted">All files are already saved.</p>
        </Card>
      </Section>

      <Section title="Single-file duplicate warning (ReceiptUpload -- 409 DUPLICATE_FILE)">
        <Card className="flex flex-col gap-3">
          <Alert variant="warning">
            <p>
              This file is already saved as Corner Store, 15.01.2026, €19.99 (Bergblick).
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              <a
                href="#"
                className="text-sm font-medium text-ink underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Open saved receipt
              </a>
              <Button variant="secondary" size="sm">
                Upload anyway
              </Button>
            </div>
          </Alert>
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
              <Alert variant="success">
                Done: 3 read, 1 failed.{' '}
                <a
                  href="/?view=report"
                  className="rounded-sm font-medium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  Open yearly report
                </a>
              </Alert>
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

      <Section title="Items view (ReceiptItems -- loading / table with nulls and its pagination (20 per page) / cards / empty / error)">
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

        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-muted">
            Items' search and filter rows: row 1 the search bar -- one control group (one border, rounded-control;
            the input has no border or ring of its own) with a magnifier, the placeholder, a "×" while there is
            text, and the primary "Search" button (magnifier + text) joined to its right edge; row 2 Year, Status
            and Sort by as three equal columns -- every control 44px tall. Focusing the input rings the whole bar
            once; the button has its own inset white ring. The interactive bar (top, with text) works for real --
            type, clear, Tab through it; the three below are static states. Year is shown as an active filter.
          </p>
          <form onSubmit={(e) => e.preventDefault()}>
            <ItemsSearchField
              id="styleguide-items-search"
              value={sgItemsSearch}
              onChange={setSgItemsSearch}
              onClear={() => setSgItemsSearch('')}
            />
          </form>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {(
              [
                { key: 'idle', caption: 'Idle (empty)', value: '', sampleFocus: undefined },
                { key: 'input', caption: 'Input focused (one ring around the bar)', value: '', sampleFocus: 'input' },
                { key: 'button', caption: 'Search button focused (its own inset ring)', value: 'Kaffee', sampleFocus: 'button' },
              ] as const
            ).map((sample) => (
              <div key={sample.key} className="flex flex-col gap-1">
                <p className="text-xs text-ink-muted">{sample.caption}</p>
                <form onSubmit={(e) => e.preventDefault()}>
                  <ItemsSearchField
                    id={`styleguide-items-search-${sample.key}`}
                    value={sample.value}
                    onChange={() => {}}
                    onClear={() => {}}
                    sampleFocus={sample.sampleFocus}
                  />
                </form>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Select
              id="styleguide-items-year"
              label="Year"
              value="2026"
              active
              onChange={() => {}}
              options={[
                { value: '', label: 'All years' },
                { value: '2026', label: '2026' },
              ]}
            />
            <Select
              id="styleguide-items-status"
              label="Status"
              value=""
              onChange={() => {}}
              options={[
                { value: '', label: 'All' },
                { value: 'needs_review', label: 'Needs review' },
                { value: 'approved', label: 'Approved' },
              ]}
            />
            <Select
              id="styleguide-items-sort"
              label="Sort by"
              value={itemsSortSample}
              onChange={setItemsSortSample}
              options={[
                { value: 'date_desc', label: 'Date (newest first)' },
                { value: 'date_asc', label: 'Date (oldest first)' },
                { value: 'amount_desc', label: 'Amount (high to low)' },
                { value: 'amount_asc', label: 'Amount (low to high)' },
                { value: 'store', label: 'Store (A-Z)' },
              ]}
            />
          </div>
        </div>

        {itemsViewState !== 'table' && itemsViewState !== 'cards' && (
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

          </Card>
        )}

        {(itemsViewState === 'table' || itemsViewState === 'cards') && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p role="status" className="text-sm text-ink-muted">
                12 items for &quot;milch&quot;
              </p>
              <Button variant="secondary" size="sm">
                Clear filters
              </Button>
            </div>
            {itemsViewState === 'table' ? (
              <ItemsTable
                items={SAMPLE_ITEM_ROWS}
                showApartment
                hrefFor={(id) => `/?receipt=${id}`}
                onOpen={() => {}}
              />
            ) : (
              <ItemCardList
                items={SAMPLE_ITEM_ROWS}
                showApartment
                hrefFor={(id) => `/?receipt=${id}`}
                onOpen={() => {}}
              />
            )}
            {itemsViewState === 'table' && (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-ink-muted">Showing 21–40 of 268</p>
                <Pagination currentPage={2} totalPages={14} hrefForPage={(n) => `#items-page-${n}`} onPageChange={() => {}} />
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title="Yearly report (ReceiptReport -- solid apartment cards in their tone and a solid slate-700 Both apartments card, all with white text; Show by month, export card with its short note, VAT note)">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card surface={apartmentToneClasses('oberaudorf-bergblick').card} className="flex flex-col gap-3">
            <h2
              className={`text-base font-semibold ${apartmentToneClasses('oberaudorf-bergblick').cardText}`}
              title="Fewo JoJo - Oberaudorf - Bergblick"
            >
              Bergblick
            </h2>
            <div className="flex items-baseline justify-between gap-4">
              <span className={`text-sm ${apartmentToneClasses('oberaudorf-bergblick').cardMutedText}`}>7 receipts</span>
              <span
                className={`text-right text-xl font-semibold tabular-nums ${apartmentToneClasses('oberaudorf-bergblick').cardText}`}
              >
                {formatMoneyFromString('1234.56', 'EUR')}
              </span>
            </div>
          </Card>
          <Card surface={apartmentToneClasses('sankt-englmar-waldglueck').card} className="flex flex-col gap-3">
            <h2
              className={`text-base font-semibold ${apartmentToneClasses('sankt-englmar-waldglueck').cardText}`}
              title="Fewo JoJo - Sankt Englmar - Waldglück"
            >
              Waldglück
            </h2>
            <p className={`text-sm ${apartmentToneClasses('sankt-englmar-waldglueck').cardMutedText}`}>
              No receipts in 2026.
            </p>
          </Card>
          <Card variant="emphasis" className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-white">Both apartments</h2>
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm text-white/90">7 receipts</span>
              <span className="text-right text-xl font-semibold tabular-nums text-white">
                {formatMoneyFromString('1234.56', 'EUR')}
              </span>
            </div>
          </Card>
        </div>

        <p className="text-sm text-ink-muted">
          Under the summary cards: a closed "Show by month" (all 12 months, a dash where a month has no
          data, no currency heading for a single currency), then the export card, then the VAT note.
        </p>

        <p className="text-sm font-medium text-ink">Export card -- basis all, with things still open</p>
        <ExportCard
          year={2026}
          basis="all"
          apartments={SAMPLE_EXPORT_APARTMENTS}
          openItems={exportOpenItems(SAMPLE_REPORT_WITH_CHECKS, 'all')}
        />
        <p className="text-sm font-medium text-ink">Same data, basis approved ("not approved")</p>
        <ExportCard
          year={2026}
          basis="approved"
          apartments={SAMPLE_EXPORT_APARTMENTS}
          openItems={exportOpenItems(
            {
              ...SAMPLE_REPORT_WITH_CHECKS,
              counted_unreviewed: 0,
              excluded: { ...SAMPLE_REPORT_WITH_CHECKS.excluded, not_approved: 5 },
            },
            'approved',
          )}
        />
        <p className="text-sm font-medium text-ink">Nothing open (no note at all)</p>
        <ExportCard
          year={2026}
          basis="all"
          apartments={SAMPLE_EXPORT_APARTMENTS}
          openItems={exportOpenItems(SAMPLE_REPORT_ALL_CLEAR, 'all')}
        />
        <ExportCard year={null} basis="all" apartments={null} />
        <p className="text-sm text-ink-muted">{VAT_FOOTNOTE}</p>
      </Section>
    </div>
  )
}

export default StyleGuide
